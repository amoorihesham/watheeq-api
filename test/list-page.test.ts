import { type SQL, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { byName } from '../src/db/order.js';
import { createDb } from '../src/db/pool.js';
import { booleanFilter, idFilter, optionalText, pageQuery, valueFilter } from '../src/http/filters.js';
import { fingerprintOf, listPage, type SortKeyType } from '../src/http/list.js';
import { validate } from '../src/http/validate.js';
import { createIsolatedDb, type IsolatedDbType } from './helpers/db.js';

// Phase 8 spec 4.2.3 and R8.7, R8.8 (step 8.1): the cursor, the fingerprint, and the snapshot of `listPage`.

let iso: IsolatedDbType;
let db: ReturnType<typeof createDb>;

const probeTable = pgTable('list_probe', { name: text() });
const probe = sql.identifier('list_probe');
const createdAt = sql`created_at`;
const id = sql`id`;
const nameExpr = byName(probeTable.name);

const BY_TIME: SortKeyType[] = [
  { expr: createdAt, type: 'timestamptz' },
  { expr: id, type: 'uuid' },
];
const BY_NAME: SortKeyType[] = [
  { expr: nameExpr, type: 'text' },
  { expr: id, type: 'uuid' },
];
const BY_RANK: SortKeyType[] = [
  { expr: sql`rank`, type: 'integer' },
  { expr: id, type: 'uuid' },
];

const querySchema = z.object({
  kind: valueFilter(['a', 'b'], 'all'),
  retired: booleanFilter('false'),
  ...pageQuery,
});

type ProbeRowType = {
  id: string;
  name: string;
  createdAt: string;
  sortValues: string[];
};

interface ListOptionsType {
  list?: string;
  query?: unknown;
  keys?: SortKeyType[];
  direction?: 'asc' | 'desc';
  betweenQueries?: () => Promise<void>;
}

/** Lists the probe table; `kind` and `retired` are real filters, so the fingerprint has something to protect. */
function list(options: ListOptionsType = {}) {
  const query = validate(querySchema, options.query ?? {});
  const where = (filters: { kind: string; retired: string }): SQL | undefined => {
    const conditions: SQL[] = [];
    if (filters.kind !== 'all') {
      conditions.push(sql`kind = ${filters.kind}`);
    }
    if (filters.retired !== 'all') {
      conditions.push(sql`retired = ${filters.retired === 'true'}`);
    }
    return conditions.length > 0 ? sql.join(conditions, sql` and `) : undefined;
  };
  return listPage<ProbeRowType, typeof query>({
    db,
    list: options.list ?? 'probe',
    query,
    keys: options.keys ?? BY_TIME,
    direction: options.direction ?? 'desc',
    where,
    selectPage: async (tx, page) => {
      const { rows } = await tx.execute<ProbeRowType>(
        sql`select id, name, created_at::text as "createdAt", ${page.sortValues} as "sortValues"
            from ${probe}
            ${page.where ? sql`where ${page.where}` : sql``}
            order by ${sql.join(page.orderBy, sql`, `)}
            limit ${page.limit}`,
      );
      return rows;
    },
    count: async (tx, base) => {
      const { rows } = await tx.execute<{ n: string }>(sql`select count(*) as n from ${probe} ${base ? sql`where ${base}` : sql``}`);
      return Number(rows[0]?.n);
    },
    ...(options.betweenQueries ? { betweenQueries: options.betweenQueries } : {}),
  });
}

const insert = async (name: string, time: string, extra: { kind?: string; retired?: boolean; rank?: number; id?: string } = {}) => {
  const { rows } = await iso.pool.query<{ id: string }>('insert into list_probe (id, name, created_at, kind, retired, rank) values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6) returning id', [
    extra.id ?? null,
    name,
    time,
    extra.kind ?? 'a',
    extra.retired ?? false,
    extra.rank ?? 0,
  ]);
  return rows[0]?.id ?? '';
};

const cursorOf = (page: { nextCursor: string | null }) => page.nextCursor ?? '';
const edit = (cursor: string, change: (parsed: Record<string, unknown>) => void) => {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  change(parsed);
  return Buffer.from(JSON.stringify(parsed)).toString('base64url');
};
const invalidCursor = {
  code: 'VALIDATION_FAILED',
  details: [{ path: 'cursor', code: 'invalid_cursor' }],
};

beforeAll(async () => {
  iso = await createIsolatedDb();
  db = createDb(iso.pool);
  await iso.pool.query(
    `create table list_probe (
       id uuid primary key default gen_random_uuid(),
       name text not null,
       created_at timestamptz not null,
       kind text not null default 'a',
       retired boolean not null default false,
       rank integer not null default 0
     )`,
  );
});

afterAll(async () => {
  await iso.drop();
});

beforeEach(async () => {
  await iso.pool.query('truncate list_probe');
});

describe('pages and cursors', () => {
  it('returns an empty list as no items, no cursor, and a total of 0', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('walks a list to its end, newest first, with the total on every page and no cursor after the last', async () => {
    for (let n = 1; n <= 5; n++) {
      await insert(`Row ${n}`, `2026-10-20 09:00:0${n}+00`);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list({ query: { limit: '2', ...(cursor ? { cursor } : {}) } });
      expect(page.total).toBe(5);
      seen.push(...page.items.map((item) => item.name));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(seen).toEqual(['Row 5', 'Row 4', 'Row 3', 'Row 2', 'Row 1']);
    expect(pages).toBe(3);
  });

  it('returns no cursor when the last page is exactly full', async () => {
    await insert('One', '2026-10-20 09:00:01+00');
    await insert('Two', '2026-10-20 09:00:02+00');
    const page = await list({ query: { limit: '2' } });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('does not return the sort values with the items', async () => {
    await insert('One', '2026-10-20 09:00:01+00');
    const [item] = (await list()).items;
    expect(Object.keys(item ?? {}).sort()).toEqual(['createdAt', 'id', 'name']);
  });

  it('keeps microseconds: .123400 follows .123456 instead of being skipped', async () => {
    const later = await insert('Later', '2026-10-20 09:00:00.123456+00');
    const earlier = await insert('Earlier', '2026-10-20 09:00:00.123400+00');
    const first = await list({ query: { limit: '1' } });
    expect(first.items.map((item) => item.id)).toEqual([later]);
    const second = await list({ query: { limit: '1', cursor: cursorOf(first) } });
    expect(second.items.map((item) => item.id)).toEqual([earlier]);
    expect(second.items[0]?.createdAt).toBe('2026-10-20 09:00:00.1234+00');
  });

  it('continues through rows that share a sort value by their ID, repeating and skipping none', async () => {
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
    for (const rowId of ids) {
      await insert('Tie', '2026-10-20 09:00:00+00', { id: rowId });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ query: { limit: '1', ...(cursor ? { cursor } : {}) } });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
  });

  it('continues after the last item of a page was deleted', async () => {
    const newest = await insert('Newest', '2026-10-20 09:00:03+00');
    const middle = await insert('Middle', '2026-10-20 09:00:02+00');
    await insert('Oldest', '2026-10-20 09:00:01+00');
    const first = await list({ query: { limit: '2' } });
    expect(first.items.map((item) => item.id)).toEqual([newest, middle]);
    await iso.pool.query('delete from list_probe where id = $1', [middle]);
    const second = await list({ query: { limit: '2', cursor: cursorOf(first) } });
    expect(second.items.map((item) => item.name)).toEqual(['Oldest']);
  });

  it('orders names case-insensitively with the ICU collation and pages through them (ascending)', async () => {
    for (const name of ['banana', 'Apple', 'apple pie', 'Cherry', 'أحمد', 'date']) {
      await insert(name, '2026-10-20 09:00:00+00');
    }
    const all = await list({ keys: BY_NAME, direction: 'asc', query: { limit: '100' } });
    const expected = all.items.map((item) => item.name);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({
        keys: BY_NAME,
        direction: 'asc',
        query: { limit: '2', ...(cursor ? { cursor } : {}) },
      });
      seen.push(...page.items.map((item) => item.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(seen.slice(0, 3)).toEqual(['Apple', 'apple pie', 'banana']);
  });

  it('pages by an integer sort key', async () => {
    for (const rank of [3, 1, 2]) {
      await insert(`Rank ${rank}`, '2026-10-20 09:00:00+00', { rank });
    }
    const first = await list({ keys: BY_RANK, direction: 'asc', query: { limit: '2' } });
    expect(first.items.map((item) => item.name)).toEqual(['Rank 1', 'Rank 2']);
    const second = await list({
      keys: BY_RANK,
      direction: 'asc',
      query: { limit: '2', cursor: cursorOf(first) },
    });
    expect(second.items.map((item) => item.name)).toEqual(['Rank 3']);
  });

  it('counts the filtered list, not the table, and applies filters to every page', async () => {
    await insert('A1', '2026-10-20 09:00:01+00', { kind: 'a' });
    await insert('A2', '2026-10-20 09:00:02+00', { kind: 'a' });
    await insert('B1', '2026-10-20 09:00:03+00', { kind: 'b' });
    await insert('Gone', '2026-10-20 09:00:04+00', { kind: 'a', retired: true });
    const first = await list({ query: { kind: 'a', limit: '1' } });
    expect(first.total).toBe(2);
    const second = await list({ query: { kind: 'a', limit: '1', cursor: cursorOf(first) } });
    expect(second.items.map((item) => item.name)).toEqual(['A1']);
    expect((await list({ query: { retired: 'all' } })).total).toBe(4);
  });
});

describe('the cursor is tied to its list and filters (R8.7)', () => {
  let cursor = '';

  beforeEach(async () => {
    await insert('One', '2026-10-20 09:00:01+00');
    await insert('Two', '2026-10-20 09:00:02+00');
    cursor = cursorOf(await list({ query: { limit: '1' } }));
  });

  const refused = (options: ListOptionsType) =>
    list(options).then(
      () => undefined,
      (err: { code?: string; details?: unknown }) => ({ code: err.code, details: err.details }),
    );

  it('accepts the cursor with the same filters, in any order, with defaults spelled out', async () => {
    const page = await list({ query: { limit: '5', retired: 'false', kind: 'all', cursor } });
    expect(page.items.map((item) => item.name)).toEqual(['One']);
    expect(fingerprintOf('probe', { kind: 'all', retired: 'false', q: null })).toBe(fingerprintOf('probe', { q: null, retired: 'false', kind: 'all' }));
    expect(await list({ query: { cursor, retired: 'false' } }).then((page) => page.items.length)).toBe(1);
  });

  it('refuses the cursor with other filters', async () => {
    expect(await refused({ query: { cursor, kind: 'b' } })).toEqual(invalidCursor);
    expect(await refused({ query: { cursor, retired: 'all' } })).toEqual(invalidCursor);
  });

  it('refuses the cursor of another list', async () => {
    expect(await refused({ list: 'other', query: { cursor } })).toEqual(invalidCursor);
  });

  it('ignores the page size when checking the cursor', async () => {
    expect((await list({ query: { cursor, limit: '50' } })).items).toHaveLength(1);
  });

  it.each([
    ['not base64 JSON', () => 'not-a-cursor'],
    ['empty', () => ''],
    ['a JSON array', () => Buffer.from('[]').toString('base64url')],
    ['null', () => Buffer.from('null').toString('base64url')],
    [
      'another version',
      (c: string) =>
        edit(c, (p) => {
          p.v = 2;
        }),
    ],
    [
      'an altered fingerprint',
      (c: string) =>
        edit(c, (p) => {
          p.fp = '0000000000000000';
        }),
    ],
    [
      'a missing fingerprint',
      (c: string) =>
        edit(c, (p) => {
          delete p.fp;
        }),
    ],
    [
      'too few values',
      (c: string) =>
        edit(c, (p) => {
          p.after = ['2026-10-20 09:00:01+00'];
        }),
    ],
    [
      'too many values',
      (c: string) =>
        edit(c, (p) => {
          (p.after as string[]).push('x');
        }),
    ],
    [
      'a number as a value',
      (c: string) =>
        edit(c, (p) => {
          (p.after as unknown[])[0] = 5;
        }),
    ],
    [
      'a value that is no timestamp',
      (c: string) =>
        edit(c, (p) => {
          (p.after as string[])[0] = 'yesterday';
        }),
    ],
    [
      'a timestamp PostgreSQL refuses',
      (c: string) =>
        edit(c, (p) => {
          (p.after as string[])[0] = '2026-13-45 09:00:00+00';
        }),
    ],
    [
      'a value that is no UUID',
      (c: string) =>
        edit(c, (p) => {
          (p.after as string[])[1] = 'not-a-uuid';
        }),
    ],
  ])('refuses a cursor that is %s', async (_label, make) => {
    expect(await refused({ query: { cursor: make(cursor) } })).toEqual(invalidCursor);
  });

  it('serves a cursor edited to start elsewhere as a valid page of the rows after that point', async () => {
    const moved = edit(cursor, (p) => {
      p.after = ['2026-10-20 09:00:01.5+00', 'ffffffff-ffff-4fff-8fff-ffffffffffff'];
    });
    expect((await list({ query: { cursor: moved } })).items.map((item) => item.name)).toEqual(['One']);
  });
});

describe('the page and the total share one snapshot (R8.8)', () => {
  it('does not let a row inserted between the two queries make the total disagree with the page', async () => {
    await insert('One', '2026-10-20 09:00:01+00');
    await insert('Two', '2026-10-20 09:00:02+00');
    const page = await list({
      query: { limit: '10' },
      betweenQueries: async () => {
        await insert('Intruder', '2026-10-20 09:00:03+00');
      },
    });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
    expect((await list()).total).toBe(3);
  });

  it('runs both queries read-only at REPEATABLE READ', async () => {
    const seen: string[] = [];
    await listPage<ProbeRowType, { limit: number }>({
      db,
      list: 'probe',
      query: { limit: 1 },
      keys: BY_TIME,
      direction: 'desc',
      where: () => undefined,
      selectPage: async (tx) => {
        const { rows } = await tx.execute<{ level: string; mode: string }>(sql`select current_setting('transaction_isolation') as level, current_setting('transaction_read_only') as mode`);
        seen.push(`${rows[0]?.level} ${rows[0]?.mode}`);
        return [];
      },
      count: async () => 0,
    });
    expect(seen).toEqual(['repeatable read on']);
  });
});

describe('filter pieces (R8.9)', () => {
  const schema = z.object({
    flag: booleanFilter('false'),
    kind: valueFilter(['a', 'b'], 'all'),
    unit: idFilter({ none: true }),
    owner: idFilter({ none: false }),
    q: optionalText(5).optional(),
    ...pageQuery,
  });
  const problems = (input: unknown) => {
    try {
      validate(schema, input);
    } catch (err) {
      return (err as { details: unknown }).details;
    }
    return undefined;
  };

  it('applies the defaults', () => {
    expect(validate(schema, {})).toEqual({
      flag: 'false',
      kind: 'all',
      unit: 'all',
      owner: 'all',
      limit: 25,
    });
  });

  it('accepts each documented value', () => {
    expect(validate(schema, { flag: 'all', kind: 'b', unit: 'none' })).toMatchObject({
      flag: 'all',
      kind: 'b',
      unit: 'none',
    });
  });

  it('lower-cases an ID', () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    expect(validate(schema, { unit: upper }).unit).toBe(upper.toLowerCase());
  });

  it('reports an unaccepted value as invalid_value at the filter', () => {
    expect(problems({ flag: 'maybe' })).toEqual([{ path: 'flag', code: 'invalid_value' }]);
    expect(problems({ kind: 'c' })).toEqual([{ path: 'kind', code: 'invalid_value' }]);
    expect(problems({ unit: 'nope' })).toEqual([{ path: 'unit', code: 'invalid_value' }]);
    expect(problems({ owner: 'none' })).toEqual([{ path: 'owner', code: 'invalid_value' }]);
    expect(problems({ unit: ['all', 'none'] })).toEqual([{ path: 'unit', code: 'invalid_value' }]);
  });

  it.each([
    ['0', 'too_small'],
    ['101', 'too_big'],
    ['abc', 'invalid_type'],
  ])('reports limit=%s as %s', (limit, code) => {
    expect(problems({ limit })).toEqual([{ path: 'limit', code }]);
  });

  it('accepts limits 1 and 100', () => {
    expect(validate(schema, { limit: '1' }).limit).toBe(1);
    expect(validate(schema, { limit: '100' }).limit).toBe(100);
  });

  it('trims optional text and turns a blank into null', () => {
    expect(validate(schema, { q: '  ab ' }).q).toBe('ab');
    expect(validate(schema, { q: '   ' }).q).toBeNull();
    expect(problems({ q: 'abcdefg' })).toEqual([{ path: 'q', code: 'too_big' }]);
  });
});
