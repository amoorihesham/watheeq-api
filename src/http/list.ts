import { createHash } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/pool.js';
import { AppError } from './errors.js';
import type { PageType } from './respond.js';

/** The SQL type a cursor value is cast back to; values travel as text so no precision is lost on the way. */
type SortTypeType = 'text' | 'uuid' | 'integer' | 'timestamptz';

/** A sort expression, exactly as written in ORDER BY (including `COLLATE`). It must never be null. */
export interface SortKeyType {
  expr: SQL;
  type: SortTypeType;
}

export interface ListQueryType {
  cursor?: string | undefined;
  limit: number;
}

export interface PageRequestType {
  /** The filter conditions plus, after the first page, the cursor condition. */
  where: SQL | undefined;
  orderBy: SQL[];
  /** One more than the page size: the extra row only says whether a next page exists. */
  limit: number;
  /** Selected as a column named `sortValues`: the sort values of the row, as text. */
  sortValues: SQL<string[]>;
}

interface CursorType {
  v: 1;
  after: string[];
  fp: string;
}

const CURSOR_VERSION = 1;

const VALUE_FORMATS: Record<SortTypeType, RegExp> = {
  text: /^[\s\S]*$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  integer: /^-?\d{1,9}$/,
  timestamptz: /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/,
};

const invalidCursor = () => new AppError('VALIDATION_FAILED', [{ path: 'cursor', code: 'invalid_cursor' }]);

/** JSON with every object's keys sorted, so equal filters always give equal text. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (item !== null && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item));
}

/** Ties a cursor to one list and one set of filters (defaults included), so it cannot be replayed elsewhere. */
export function fingerprintOf(list: string, filters: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson({ list, filters })).digest('hex').slice(0, 16);
}

export function encodeCursor(after: string[], fp: string): string {
  const cursor: CursorType = { v: CURSOR_VERSION, after, fp };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** The sort values a cursor carries, or an `invalid_cursor` error for anything that is not this list's cursor. */
export function decodeCursor(raw: string, fp: string, types: SortTypeType[]): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidCursor();
  }
  const { v, after, fp: cursorFp } = parsed as Record<string, unknown>;
  if (v !== CURSOR_VERSION || cursorFp !== fp || !Array.isArray(after) || after.length !== types.length) {
    throw invalidCursor();
  }
  const values = after.filter((value): value is string => typeof value === 'string');
  if (values.length !== types.length || !values.every((v, i) => VALUE_FORMATS[types[i] ?? 'text'].test(v))) {
    throw invalidCursor();
  }
  return values;
}

/** `(k1, ..., id) < ($1, ..., $n)`, with the same expressions as ORDER BY. */
function afterCondition(keys: SortKeyType[], direction: 'asc' | 'desc', values: string[]): SQL {
  const columns = sql.join(
    keys.map((key) => key.expr),
    sql`, `,
  );
  const params = sql.join(
    keys.map((key, index) => sql`${values[index]}::${sql.raw(key.type)}`),
    sql`, `,
  );
  return sql`(${columns}) ${sql.raw(direction === 'asc' ? '>' : '<')} (${params})`;
}

/** SQLSTATE class 22 (data exception): a cursor value that passed the format check but PostgreSQL rejects. */
const isBadValueError = (err: unknown): boolean => {
  const pgError = ((err as { cause?: unknown } | null)?.cause ?? err) as { code?: string } | null;
  return typeof pgError?.code === 'string' && pgError.code.startsWith('22');
};

/**
 * The one implementation of cursor paging (Phase 8 spec 4.2.3). `keys` are the sort expressions in ORDER BY order,
 * the unique ID last, all in one `direction`. The page and the total are read in one read-only snapshot so they
 * agree. `where` builds the filter conditions from the validated filters (tenant and visibility included); the
 * callbacks run the page and count queries inside the snapshot.
 *
 * `betweenQueries` exists for a test to change data after the page query ran and before the count.
 */
export async function listPage<Row extends { sortValues: string[] }, Q extends ListQueryType>(options: {
  db: Db;
  list: string;
  query: Q;
  keys: SortKeyType[];
  direction: 'asc' | 'desc';
  where: (filters: Omit<Q, 'cursor' | 'limit'>) => SQL | undefined;
  selectPage: (tx: Tx, page: PageRequestType) => Promise<Row[]>;
  count: (tx: Tx, where: SQL | undefined) => Promise<number>;
  betweenQueries?: () => Promise<void>;
}): Promise<PageType<Omit<Row, 'sortValues'>>> {
  const { db, list, query, keys, direction } = options;
  const { cursor, limit, ...filters } = query;
  const fp = fingerprintOf(list, filters);
  const after =
    cursor === undefined
      ? undefined
      : decodeCursor(
          cursor,
          fp,
          keys.map((key) => key.type),
        );
  const baseWhere = options.where(filters);
  const pageWhere = after === undefined ? baseWhere : baseWhere ? sql`${baseWhere} and ${afterCondition(keys, direction, after)}` : afterCondition(keys, direction, after);
  const dir = sql.raw(direction);
  const sortValues = sql<string[]>`array[${sql.join(
    keys.map((key) => sql`(${key.expr})::text`),
    sql`, `,
  )}]::text[]`;

  let rows: Row[];
  let total: number;
  try {
    ({ rows, total } = await db.transaction(
      async (tx) => {
        const found = await options.selectPage(tx, {
          where: pageWhere,
          orderBy: keys.map((key) => sql`${key.expr} ${dir}`),
          limit: limit + 1,
          sortValues,
        });
        await options.betweenQueries?.();
        return { rows: found, total: await options.count(tx, baseWhere) };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ));
  } catch (err) {
    if (after !== undefined && isBadValueError(err)) {
      throw invalidCursor();
    }
    throw err;
  }

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const items = pageRows.map(({ sortValues: _omit, ...item }) => item);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last.sortValues, fp) : null,
    total,
  };
}

/**
 * Pages a list that lives in code, not in a table (the permission catalog), with the same cursor and fingerprint
 * rules as `listPage`. `keyOf` is the unique sort key; a cursor whose key is no longer in the list is invalid.
 */
export function listInMemory<T, Q extends ListQueryType>(options: { list: string; query: Q; items: readonly T[]; keyOf: (item: T) => string }): PageType<T> {
  const { list, query, items, keyOf } = options;
  const { cursor, limit, ...filters } = query;
  const fp = fingerprintOf(list, filters);
  let start = 0;
  if (cursor !== undefined) {
    const [key] = decodeCursor(cursor, fp, ['text']);
    const at = items.findIndex((item) => keyOf(item) === key);
    if (at < 0) {
      throw invalidCursor();
    }
    start = at + 1;
  }
  const pageItems = items.slice(start, start + limit);
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    nextCursor: start + limit < items.length && last ? encodeCursor([keyOf(last)], fp) : null,
    total: items.length,
  };
}
