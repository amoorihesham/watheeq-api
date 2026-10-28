import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, rejectionText, seedRole, seedSubscribedTenant } from './helpers/db.js';

const PASSWORD = 'correct horse battery staple';
const SARA = 'sara@pri-alnoor.test';
const HUDA = 'huda@pri-alnoor.test';
const NORA = 'nora@pri-alnoor.test';
const VIEWER = 'viewer@pri-alnoor.test';
const RASHID_ADMIN = 'admin@pri-alrashid.test';

const pool = connectToTestDb();
const app = testApp(pool, createLogger('silent'));

let alNoor = '';
let sara = '';
let huda = '';
let nora = '';
let viewer = '';
let rashid = '';
let hudaId = '';

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', accessCookie(access)),
  post: (path: string, body: object = {}) => request(app).post(path).set('Cookie', accessCookie(access)).send(body),
  put: (path: string, body: object) => request(app).put(path).set('Cookie', accessCookie(access)).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set('Cookie', accessCookie(access)).send(body),
});

const org = (key: string) => ({ key, scope: 'organization' });

interface PriorityBody {
  id: string;
  name: string;
  days: number;
  retired: boolean;
}

async function create(name: string, days: number, token = huda): Promise<string> {
  const res = await as(token).post('/priorities', { name, days });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

const orderOf = async (token = huda, query = '') => (await as(token).get(`/priorities${query}`)).body.data.map((p: PriorityBody) => p.name);

const idsOf = async (token = huda) => (await as(token).get('/priorities')).body.data.map((p: PriorityBody) => p.id) as string[];

const auditOf = (resourceId: string) => pool.query('select action, tenant_id, actor_type, actor_id, details from audit_log where resource_id = $1 order by id', [resourceId]).then((result) => result.rows);

/** The places the database holds for a tenant's active priorities. */
const placesOf = (tenantId: string) => pool.query('select sort_order from priorities where tenant_id = $1 and retired_at is null order by sort_order', [tenantId]).then((result) => result.rows.map((row) => row.sort_order as number));

/** Wipes a tenant's priorities, so each group of tests starts from an empty list. */
async function clearPriorities(tenantId: string) {
  await pool.query('delete from priorities where tenant_id = $1', [tenantId]);
}

async function whileHolding(lockSql: string, params: unknown[], during: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(lockSql, params);
    await during(client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Al-Noor's list as in the spec: Urgent 2 days, High 5, Normal 10. */
async function seedAlNoorList() {
  await clearPriorities(alNoor);
  return {
    urgent: await create('Urgent', 2),
    high: await create('High', 5),
    normal: await create('Normal', 10),
  };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, 'pri-al-noor', [
    { email: SARA, userName: 'Sara', passwordHash },
    { email: HUDA, userName: 'Huda', passwordHash },
    { email: NORA, userName: 'Nora', passwordHash },
    { email: VIEWER, userName: 'Viewer', passwordHash },
  ]);
  alNoor = tenant.id;
  hudaId = tenant.userIds[1] ?? '';
  const headOfLegal = await seedRole(pool, alNoor, {
    name: 'Head of Legal',
    permissions: ['priority.view', 'priority.manage'].map(org),
  });
  const viewerRole = await seedRole(pool, alNoor, {
    name: 'Priority Viewer',
    permissions: [org('priority.view')],
  });
  await pool.query('update tenant_members set role_id = $1 where user_id = $2', [headOfLegal, hudaId]);
  await pool.query('update tenant_members set role_id = $1 where user_id = $2', [viewerRole, tenant.userIds[3]]);
  await seedSubscribedTenant(pool, 'pri-al-rashid', [{ email: RASHID_ADMIN, passwordHash }]);

  sara = (await login(app, SARA, PASSWORD)).access;
  huda = (await login(app, HUDA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe('creating and ordering priorities (R5.12)', () => {
  it('lists Urgent, High, Normal in order, appends Low, and audits each create', async () => {
    const { urgent } = await seedAlNoorList();
    expect(await orderOf()).toEqual(['Urgent', 'High', 'Normal']);
    const list = (await as(huda).get('/priorities')).body.data;
    expect(list.map((p: PriorityBody) => p.days)).toEqual([2, 5, 10]);
    expect(list[0]).toEqual({ id: urgent, name: 'Urgent', days: 2, retired: false });

    const low = await as(huda).post('/priorities', { name: 'Low', days: 20 });
    expect(low.status).toBe(201);
    expect(low.body.data).toEqual({
      id: expect.any(String),
      name: 'Low',
      days: 20,
      retired: false,
    });
    expect(await orderOf()).toEqual(['Urgent', 'High', 'Normal', 'Low']);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3, 4]);

    const audit = await auditOf(low.body.data.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'priority.created',
      tenant_id: alNoor,
      actor_type: 'user',
      actor_id: hudaId,
      details: { name: 'Low', days: 20 },
    });
  });

  it('refuses a second name in any case, and leaves the order alone', async () => {
    await seedAlNoorList();
    const res = await as(huda).post('/priorities', { name: 'URGENT', days: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TAKEN');
    expect(res.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
    expect(await orderOf()).toEqual(['Urgent', 'High', 'Normal']);
    expect((await as(huda).post('/priorities', { name: 'After', days: 3 })).status).toBe(201);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3, 4]);
  });

  it('validates the name and the days (1 to 365)', async () => {
    const post = (body: object) => as(huda).post('/priorities', body);
    expect((await post({ name: 'Edge Low', days: 1 })).status).toBe(201);
    expect((await post({ name: 'Edge High', days: 365 })).status).toBe(201);
    for (const body of [{ name: 'Zero', days: 0 }, { name: 'Over', days: 366 }, { name: 'Fraction', days: 2.5 }, { name: 'Text', days: '5' }, { name: '  ', days: 5 }, { name: 'x'.repeat(101), days: 5 }, { days: 5 }, { name: 'NoDays' }]) {
      expect((await post(body)).status).toBe(400);
    }
    const unknown = await post({ name: 'Extra', days: 5, sortOrder: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual([{ path: 'sortOrder', code: 'unknown_field' }]);
  });
});

describe('reordering (R5.12)', () => {
  it('sets the order as a whole list, audited with before and after', async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    const res = await as(huda).put('/priorities/order', { ids: [normal, urgent, high] });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(await orderOf()).toEqual(['Normal', 'Urgent', 'High']);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3]);

    const audit = await auditOf(alNoor);
    const reordered = audit.filter((entry) => entry.action === 'priority.reordered').at(-1);
    expect(reordered).toMatchObject({
      tenant_id: alNoor,
      actor_id: hudaId,
      details: { before: [urgent, high, normal], after: [normal, urgent, high] },
    });
  });

  it('swaps two priorities and reverses a longer list', async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    await as(huda).put('/priorities/order', { ids: [high, urgent, normal] });
    expect(await orderOf()).toEqual(['High', 'Urgent', 'Normal']);
    await as(huda).put('/priorities/order', { ids: [normal, urgent, high] });
    expect(await orderOf()).toEqual(['Normal', 'Urgent', 'High']);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3]);
  });

  it('changes nothing and audits nothing when the order is the current one', async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    const before = (await auditOf(alNoor)).length;
    const res = await as(huda).put('/priorities/order', { ids: [urgent, high, normal] });
    expect(res.status).toBe(204);
    expect((await auditOf(alNoor)).length).toBe(before);
  });

  it('refuses a list that is not exactly the active priorities', async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    const retired = await create('Old', 30);
    await as(huda).post(`/priorities/${retired}/retire`);
    const foreign = await create('Theirs', 4, rashid);
    const attempts = {
      missing: [urgent, high],
      extra: [urgent, high, normal, foreign],
      duplicated: [urgent, urgent, high],
      'duplicated to full length': [urgent, high, high],
      retired: [urgent, high, normal, retired],
      'retired instead of active': [urgent, high, retired],
      unknown: [urgent, high, '11111111-1111-4111-8111-111111111111'],
      malformed: [urgent, high, 'nope'],
      empty: [],
    };
    for (const [label, ids] of Object.entries(attempts)) {
      const res = await as(huda).put('/priorities/order', { ids });
      expect(res.status, label).toBe(400);
      expect(res.body.error.details, label).toEqual([{ path: 'ids', code: 'order_mismatch' }]);
    }
    expect(await orderOf()).toEqual(['Urgent', 'High', 'Normal']);
  });

  it('requires an ids list and rejects unknown fields', async () => {
    await seedAlNoorList();
    expect((await as(huda).put('/priorities/order', {})).status).toBe(400);
    expect((await as(huda).put('/priorities/order', { ids: 'x' })).status).toBe(400);
    expect((await as(huda).put('/priorities/order', { ids: [], extra: 1 })).status).toBe(400);
  });
});

describe('changing priorities (R5.12)', () => {
  it('edits the name and the days, keeping the place, and audits before and after', async () => {
    const { high } = await seedAlNoorList();
    const res = await as(huda).patch(`/priorities/${high}`, { days: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: high, name: 'High', days: 3, retired: false });
    const renamed = await as(huda).patch(`/priorities/${high}`, { name: 'Important', days: 4 });
    expect(renamed.body.data).toMatchObject({ name: 'Important', days: 4 });
    expect(await orderOf()).toEqual(['Urgent', 'Important', 'Normal']);
    expect((await auditOf(high)).map((e) => [e.action, e.details])).toEqual([
      ['priority.created', { name: 'High', days: 5 }],
      ['priority.updated', { before: { days: 5 }, after: { days: 3 } }],
      ['priority.updated', { before: { name: 'High', days: 3 }, after: { name: 'Important', days: 4 } }],
    ]);
  });

  it('changes nothing and audits nothing when nothing differs', async () => {
    const { high } = await seedAlNoorList();
    const res = await as(huda).patch(`/priorities/${high}`, { name: 'High', days: 5 });
    expect(res.status).toBe(200);
    expect(await auditOf(high)).toHaveLength(1);
  });

  it('validates, and refuses an empty update', async () => {
    const { high } = await seedAlNoorList();
    expect((await as(huda).patch(`/priorities/${high}`, { days: 0 })).status).toBe(400);
    expect((await as(huda).patch(`/priorities/${high}`, { days: 366 })).status).toBe(400);
    const empty = await as(huda).patch(`/priorities/${high}`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details).toEqual([{ path: '', code: 'no_fields' }]);
    expect((await as(huda).patch(`/priorities/${high}`, { sortOrder: 1 })).status).toBe(400);
  });

  it('refuses a name taken by another priority, and allows changing only the case', async () => {
    const { high } = await seedAlNoorList();
    const taken = await as(huda).patch(`/priorities/${high}`, { name: 'urgent' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('TAKEN');
    expect(taken.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
    expect((await as(huda).patch(`/priorities/${high}`, { name: 'HIGH' })).status).toBe(200);
  });

  it('refuses a retired priority', async () => {
    const { high } = await seedAlNoorList();
    await as(huda).post(`/priorities/${high}/retire`);
    const res = await as(huda).patch(`/priorities/${high}`, { days: 4 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESOURCE_RETIRED');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    await seedAlNoorList();
    const unknown = '11111111-1111-4111-8111-111111111111';
    for (const id of [unknown, 'not-a-uuid']) {
      expect((await as(huda).patch(`/priorities/${id}`, { days: 4 })).status).toBe(404);
      expect((await as(huda).post(`/priorities/${id}/retire`)).status).toBe(404);
      expect((await as(huda).post(`/priorities/${id}/restore`)).status).toBe(404);
    }
  });
});

describe('listing (Phase 8 spec 4.2.3, R8.5-R8.9)', () => {
  it('answers a page with the total, retired priorities hidden by default', async () => {
    const { high } = await seedAlNoorList();
    await as(huda).post(`/priorities/${high}/retire`);
    const res = await as(huda).get('/priorities');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: PriorityBody) => p.name)).toEqual(['Urgent', 'Normal']);
    expect(res.body.page).toEqual({ nextCursor: null, total: 2 });
    expect((await as(huda).get('/priorities?retired=true')).body.data).toEqual([{ id: high, name: 'High', days: 5, retired: true }]);
    expect((await as(huda).get('/priorities?retired=all')).body.page.total).toBe(3);
  });

  it('pages in display order with a cursor, to the end', async () => {
    await seedAlNoorList();
    const first = await as(huda).get('/priorities?limit=2');
    expect(first.body.data.map((p: PriorityBody) => p.name)).toEqual(['Urgent', 'High']);
    expect(first.body.page.total).toBe(3);
    expect(first.body.page.nextCursor).toEqual(expect.any(String));
    const second = await as(huda).get(`/priorities?limit=2&cursor=${first.body.page.nextCursor}`);
    expect(second.body.data.map((p: PriorityBody) => p.name)).toEqual(['Normal']);
    expect(second.body.page).toEqual({ nextCursor: null, total: 3 });
  });

  it('refuses an unknown filter value and a cursor from other filters', async () => {
    await seedAlNoorList();
    const bad = await as(huda).get('/priorities?retired=maybe');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual([{ path: 'retired', code: 'invalid_value' }]);
    const first = await as(huda).get('/priorities?limit=1');
    const replay = await as(huda).get(`/priorities?limit=1&retired=all&cursor=${first.body.page.nextCursor}`);
    expect(replay.status).toBe(400);
    expect(replay.body.error.details).toEqual([{ path: 'cursor', code: 'invalid_cursor' }]);
  });
});

describe('retiring and restoring (R5.15)', () => {
  it('takes a retired priority out of the order and appends it again on restore', async () => {
    const { high } = await seedAlNoorList();
    const retired = await as(huda).post(`/priorities/${high}/retire`);
    expect(retired.status).toBe(200);
    expect(retired.body.data.retired).toBe(true);
    expect(await orderOf()).toEqual(['Urgent', 'Normal']);
    expect(await orderOf(huda, '?retired=all')).toEqual(['Urgent', 'Normal', 'High']);

    const restored = await as(huda).post(`/priorities/${high}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.retired).toBe(false);
    expect(await orderOf()).toEqual(['Urgent', 'Normal', 'High']);
    expect(await placesOf(alNoor)).toEqual([1, 3, 4]);
  });

  it('repeating either changes nothing and audits nothing', async () => {
    const { high } = await seedAlNoorList();
    await as(huda).post(`/priorities/${high}/retire`);
    expect((await as(huda).post(`/priorities/${high}/retire`)).status).toBe(200);
    await as(huda).post(`/priorities/${high}/restore`);
    expect((await as(huda).post(`/priorities/${high}/restore`)).status).toBe(200);
    expect((await auditOf(high)).map((entry) => entry.action)).toEqual(['priority.created', 'priority.retired', 'priority.restored']);
  });

  it('keeps a retired priority readable with its days', async () => {
    const { high } = await seedAlNoorList();
    await as(huda).post(`/priorities/${high}/retire`);
    const all = (await as(huda).get('/priorities?retired=all')).body.data;
    expect(all.find((p: PriorityBody) => p.id === high)).toEqual({
      id: high,
      name: 'High',
      days: 5,
      retired: true,
    });
  });

  it('frees the name on retire, and refuses to restore it once the name is reused', async () => {
    const { high } = await seedAlNoorList();
    await as(huda).post(`/priorities/${high}/retire`);
    await create('High', 6);
    const res = await as(huda).post(`/priorities/${high}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TAKEN');
    expect(res.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
  });

  it('lets a create after a retire take the next free place', async () => {
    const { urgent } = await seedAlNoorList();
    await as(huda).post(`/priorities/${urgent}/retire`);
    await create('Extra', 7);
    expect(await orderOf()).toEqual(['High', 'Normal', 'Extra']);
    const ids = await idsOf();
    await as(huda).put('/priorities/order', { ids: [...ids].reverse() });
    expect(await orderOf()).toEqual(['Extra', 'Normal', 'High']);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3]);
  });

  it('is kept in step by the database: a retired priority has no place, an active one has', async () => {
    const { high } = await seedAlNoorList();
    expect(await rejectionText(pool.query('update priorities set sort_order = null where id = $1', [high]))).toContain('priorities_order_iff_active');
    expect(await rejectionText(pool.query('update priorities set retired_at = now() where id = $1', [high]))).toContain('priorities_order_iff_active');
  });
});

describe('the database guards priorities (R5.12)', () => {
  it('refuses days outside 1 to 365, a padded name, and a duplicate place', async () => {
    const { urgent } = await seedAlNoorList();
    expect(await rejectionText(pool.query('update priorities set days = 0 where id = $1', [urgent]))).toContain('priorities_days_range');
    expect(await rejectionText(pool.query('update priorities set days = 366 where id = $1', [urgent]))).toContain('priorities_days_range');
    expect(await rejectionText(pool.query("update priorities set name = ' Urgent ' where id = $1", [urgent]))).toContain('priorities_name_length');
    expect(await rejectionText(pool.query('update priorities set sort_order = 2 where id = $1', [urgent]))).toContain('priorities_sort_order_unique');
  });
});

describe('concurrent changes to the order (section 5)', () => {
  const orderLock = `select pg_advisory_xact_lock(hashtextextended('priorities:' || $1::text, 0))`;

  /** Resolves once `count` statements wait on an advisory lock. */
  async function waitForWaiters(count: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const { rows } = await pool.query("select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'");
      if (rows[0].waiting >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`fewer than ${count} statements waited for the order lock`);
  }

  const reordersOf = async () => (await auditOf(alNoor)).filter((entry) => entry.action === 'priority.reordered');

  it("serializes two reorders: the second's before is the first's after", async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    const original = [urgent, high, normal];
    const known = (await reordersOf()).length;

    let pending: Promise<request.Response>[] = [];
    await whileHolding(orderLock, [alNoor], async () => {
      pending = [
        as(huda)
          .put('/priorities/order', { ids: [normal, high, urgent] })
          .then((res) => res),
        as(huda)
          .put('/priorities/order', { ids: [high, urgent, normal] })
          .then((res) => res),
      ];
      await waitForWaiters(2);
    });
    const results = await Promise.all(pending);

    expect(results.map((res) => res.status)).toEqual([204, 204]);
    const [first, second] = (await reordersOf()).slice(known);
    expect(first?.details.before).toEqual(original);
    expect(second?.details.before).toEqual(first?.details.after);
    expect(await idsOf()).toEqual(second?.details.after);
    expect(await placesOf(alNoor)).toEqual([1, 2, 3]);
  });

  it('serializes a reorder and a create: either the reorder precedes, or it no longer lists everyone', async () => {
    const { urgent, high, normal } = await seedAlNoorList();

    let pending: Promise<request.Response>[] = [];
    await whileHolding(orderLock, [alNoor], async () => {
      pending = [
        as(huda)
          .put('/priorities/order', { ids: [normal, high, urgent] })
          .then((res) => res),
        as(huda)
          .post('/priorities', { name: 'Raced', days: 9 })
          .then((res) => res),
      ];
      await waitForWaiters(2);
    });
    const [reorder, created] = await Promise.all(pending);

    expect(created?.status).toBe(201);
    const order = await orderOf();
    if (reorder?.status === 204) {
      expect(order).toEqual(['Normal', 'High', 'Urgent', 'Raced']);
    } else {
      expect(reorder?.status).toBe(400);
      expect(reorder?.body.error.details).toEqual([{ path: 'ids', code: 'order_mismatch' }]);
      expect(order).toEqual(['Urgent', 'High', 'Normal', 'Raced']);
    }
    expect(await placesOf(alNoor)).toEqual([1, 2, 3, 4]);
  });

  it('gives concurrent creates distinct places', async () => {
    await clearPriorities(alNoor);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        as(huda)
          .post('/priorities', { name: `Level ${index}`, days: index + 1 })
          .then((res) => res),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(6).fill(201));
    expect(await placesOf(alNoor)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps the places valid under concurrent reorders', async () => {
    await seedAlNoorList();
    const ids = await idsOf();
    const permutations = [
      [ids[2], ids[1], ids[0]],
      [ids[1], ids[0], ids[2]],
      [ids[0], ids[2], ids[1]],
      [ids[2], ids[0], ids[1]],
      [ids[1], ids[2], ids[0]],
    ];
    const results = await Promise.all(
      permutations.map((order) =>
        as(huda)
          .put('/priorities/order', { ids: order })
          .then((res) => res),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(5).fill(204));
    expect(await placesOf(alNoor)).toEqual([1, 2, 3]);
    expect(permutations).toContainEqual(await idsOf());
  });
});

describe('authorization (R5.17)', () => {
  it('refuses a member with no priority permissions', async () => {
    const { high } = await seedAlNoorList();
    for (const res of [
      await as(nora).get('/priorities'),
      await as(nora).post('/priorities', { name: 'X', days: 1 }),
      await as(nora).patch(`/priorities/${high}`, { days: 1 }),
      await as(nora).put('/priorities/order', { ids: [] }),
      await as(nora).post(`/priorities/${high}/retire`),
      await as(nora).post(`/priorities/${high}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('lets priority.view read but not change', async () => {
    const { high } = await seedAlNoorList();
    expect((await as(viewer).get('/priorities')).status).toBe(200);
    expect(await orderOf(viewer)).toEqual(['Urgent', 'High', 'Normal']);
    expect((await as(viewer).post('/priorities', { name: 'Y', days: 1 })).status).toBe(403);
    expect((await as(viewer).patch(`/priorities/${high}`, { days: 1 })).status).toBe(403);
    expect((await as(viewer).put('/priorities/order', { ids: await idsOf() })).status).toBe(403);
    expect((await as(viewer).post(`/priorities/${high}/retire`)).status).toBe(403);
    expect((await as(viewer).post(`/priorities/${high}/restore`)).status).toBe(403);
  });

  it('lets the Tenant Admin manage without any role change', async () => {
    await seedAlNoorList();
    expect((await as(sara).post('/priorities', { name: 'Admin Level', days: 8 })).status).toBe(201);
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get('/priorities')).status).toBe(401);
  });
});

describe('Read-only subscriptions (R5.18)', () => {
  it('refuses changes and still shows priorities', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, 'pri-read-only', [{ email: 'admin@pri-read-only.test', passwordHash }]);
    const admin = (await login(app, 'admin@pri-read-only.test', PASSWORD)).access;
    const id = await create('Before Expiry', 5, admin);
    await pool.query('update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1', [tenant.id]);
    for (const res of [
      await as(admin).post('/priorities', { name: 'Late', days: 1 }),
      await as(admin).patch(`/priorities/${id}`, { days: 2 }),
      await as(admin).put('/priorities/order', { ids: [id] }),
      await as(admin).post(`/priorities/${id}/retire`),
      await as(admin).post(`/priorities/${id}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    }
    expect((await as(admin).get('/priorities')).status).toBe(200);
  });
});

describe('tenant isolation (R5.19)', () => {
  it('shows each tenant only its own priorities, with its own order, and answers 404 across tenants', async () => {
    await seedAlNoorList();
    await clearPriorities((await pool.query("select id from tenants where slug = 'pri-al-rashid'")).rows[0].id);
    const theirs = await create('Rashid Urgent', 1, rashid);
    await create('Rashid Normal', 7, rashid);

    expect(await orderOf(huda)).toEqual(['Urgent', 'High', 'Normal']);
    expect(await orderOf(rashid)).toEqual(['Rashid Urgent', 'Rashid Normal']);
    expect((await as(huda).patch(`/priorities/${theirs}`, { days: 9 })).status).toBe(404);
    expect((await as(huda).post(`/priorities/${theirs}/retire`)).status).toBe(404);
    expect((await as(huda).post(`/priorities/${theirs}/restore`)).status).toBe(404);
  });

  it("refuses a reorder naming another tenant's priority", async () => {
    const { urgent, high, normal } = await seedAlNoorList();
    const theirs = await create('Rashid Extra', 3, rashid);
    const res = await as(huda).put('/priorities/order', { ids: [urgent, high, normal, theirs] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'ids', code: 'order_mismatch' }]);
    const swapped = await as(huda).put('/priorities/order', { ids: [urgent, high, theirs] });
    expect(swapped.status).toBe(400);
  });

  it('lets two tenants use the same priority name and the same place', async () => {
    await seedAlNoorList();
    const res = await as(rashid).post('/priorities', { name: 'Urgent', days: 1 });
    expect(res.status).toBe(201);
  });
});
