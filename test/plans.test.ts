import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor, fingerprintOf } from '../src/http/list.js';
import { createLogger } from '../src/logging/logger.js';
import { toPlanView } from '../src/modules/platform/plans/plans.service.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, seedTenant, seedUser } from './helpers/db.js';
import { listAll } from './helpers/list-all.js';

const PASSWORD = 'correct horse battery staple';

interface PlanItemType {
  id: string;
  name: string;
  createdAt: string;
}
const pool = connectToTestDb();
const app = testApp(pool, createLogger('silent'));

let omar = '';
let omarId = '';
let sara = '';

const basic = {
  name: 'Plans Basic',
  userLimit: 10,
  storageLimitGb: 10,
  graceDays: 14,
  priceHalalas: 100_000,
  paymentPeriod: 'monthly',
  discountPercent: 15,
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  omarId = await seedUser(pool, {
    email: 'omar@plans-watheeq.test',
    passwordHash,
    role: 'operator',
  });
  await seedTenant(pool, 'plans-al-noor', [{ email: 'sara@plans-alnoor.test', passwordHash }]);
  omar = (await login(app, 'omar@plans-watheeq.test', PASSWORD)).access;
  sara = (await login(app, 'sara@plans-alnoor.test', PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

const as = (access: string) => ({
  post: (path: string, body: object) => request(app).post(path).set('Cookie', accessCookie(access)).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set('Cookie', accessCookie(access)).send(body),
  get: (path: string) => request(app).get(path).set('Cookie', accessCookie(access)),
});

const auditFor = async (planId: string) => {
  const { rows } = await pool.query('select tenant_id, actor_type, actor_id, action, details from audit_log where resource_id = $1 order by id', [planId]);
  return rows;
};

describe('toPlanView (R11.8)', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Basic',
    userLimit: 10,
    storageLimitGb: 10,
    graceDays: 14,
    priceHalalas: 100_000,
    paymentPeriod: 'monthly' as const,
    discountPercent: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it.each([
    [100_000, 10, 90_000],
    [999, 12.5, 874],
    [0, 15, 0],
    [100_000, 100, 0],
    [100_000, 0, 100_000],
  ])('prices %i halalas at %d%% off as %i, rounded half up', (priceHalalas, discountPercent, expected) => {
    expect(toPlanView({ ...row, priceHalalas, discountPercent })).toEqual({ ...row, priceHalalas, discountPercent, discountedPriceHalalas: expected });
  });
});

describe('create a plan (R1.1, R1.14)', () => {
  it('creates Basic with price, payment period, and discount, and audits it at platform level', async () => {
    const res = await as(omar).post('/operator/plans', basic);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject(basic);
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.discountedPriceHalalas).toBe(85_000);

    const audit = await auditFor(res.body.data.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.after).not.toHaveProperty('discountedPriceHalalas');
    expect(audit[0]).toMatchObject({
      tenant_id: null,
      actor_type: 'operator',
      actor_id: omarId,
      action: 'plan.created',
      details: { after: { name: 'Plans Basic', priceHalalas: 100_000, discountPercent: 15 } },
    });
  });

  it('defaults the discount to 0 and keeps two-decimal discounts exact', async () => {
    const free = await as(omar).post('/operator/plans', {
      ...basic,
      name: 'Plans No Discount',
      discountPercent: undefined,
    });
    expect(free.body.data.discountPercent).toBe(0);
    const half = await as(omar).post('/operator/plans', {
      ...basic,
      name: 'Plans Yearly',
      paymentPeriod: 'yearly',
      priceHalalas: 1_100_000,
      discountPercent: 12.5,
    });
    expect(half.status).toBe(201);
    expect(half.body.data).toMatchObject({ paymentPeriod: 'yearly', discountPercent: 12.5, discountedPriceHalalas: 962_500 });
    expect(free.body.data.discountedPriceHalalas).toBe(basic.priceHalalas);
  });

  it('refuses a duplicate name in any case with 409 TAKEN, leaving no audit row', async () => {
    const res = await as(omar).post('/operator/plans', { ...basic, name: '  plans basic ' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TAKEN');
    expect(res.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
    const { rows } = await pool.query("select count(*)::int as n from audit_log where action = 'plan.created' and details->'after'->>'name' = 'plans basic'");
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ['a negative price', { priceHalalas: -1 }, 'priceHalalas'],
    ['a fractional price', { priceHalalas: 10.5 }, 'priceHalalas'],
    ['a price over 1,000,000 SAR', { priceHalalas: 100_000_001 }, 'priceHalalas'],
    ['an unknown payment period', { paymentPeriod: 'weekly' }, 'paymentPeriod'],
    ['a discount over 100', { discountPercent: 101 }, 'discountPercent'],
    ['a negative discount', { discountPercent: -1 }, 'discountPercent'],
    ['a discount with three decimals', { discountPercent: 12.345 }, 'discountPercent'],
    ['a zero user limit', { userLimit: 0 }, 'userLimit'],
    ['a grace period over 365 days', { graceDays: 366 }, 'graceDays'],
    ['a blank name', { name: '   ' }, 'name'],
  ])('rejects %s with 400', async (_label, change, path) => {
    const res = await as(omar).post('/operator/plans', {
      ...basic,
      name: `Plans ${_label}`,
      ...change,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('rejects a missing required field', async () => {
    const { priceHalalas: _omitted, ...withoutPrice } = basic;
    const res = await as(omar).post('/operator/plans', { ...withoutPrice, name: 'Plans Missing' });
    expect(res.status).toBe(400);
  });
});

describe('list and view plans', () => {
  // Other test files add plans to the same database at any moment, so the walks check only this file's plans,
  // whose order among themselves no concurrent insert can change.
  const walk = async (limit: number) => {
    const seen: PlanItemType[] = [];
    let cursor = '';
    for (;;) {
      const res = await as(omar).get(`/operator/plans?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(limit);
      seen.push(...res.body.data);
      if (!res.body.page.nextCursor) {
        return seen;
      }
      cursor = res.body.page.nextCursor;
    }
  };

  it('lists plans newest first, and pages that order one plan at a time (R11.9)', async () => {
    const pilot = (await as(omar).post('/operator/plans', { ...basic, name: 'Plans Pilot' })).body.data.id;
    const enterprise = (await as(omar).post('/operator/plans', { ...basic, name: 'Plans Enterprise' })).body.data.id;

    const first = await as(omar).get('/operator/plans');
    const ids: string[] = first.body.data.map((plan: PlanItemType) => plan.id);
    expect(ids.indexOf(enterprise)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(enterprise)).toBeLessThan(ids.indexOf(pilot));

    const seen = await walk(1);
    expect(new Set(seen.map((plan) => plan.id)).size).toBe(seen.length);
    for (let index = 1; index < seen.length; index++) {
      expect(Date.parse(seen[index - 1]?.createdAt ?? '')).toBeGreaterThanOrEqual(Date.parse(seen[index]?.createdAt ?? ''));
    }
    const own = seen.map((plan) => plan.name).filter((name) => name === 'Plans Pilot' || name === 'Plans Enterprise');
    expect(own).toEqual(['Plans Enterprise', 'Plans Pilot']);
  });

  it('orders plans created at the same moment by ID descending, with no skip or repeat across pages', async () => {
    const client = await pool.connect();
    let sameMoment: string[] = [];
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into plans (name, user_limit, grace_days, price_halalas, payment_period)
         values ('Plans Twin A', 5, 14, 1000, 'monthly'), ('Plans Twin B', 5, 14, 1000, 'monthly'), ('Plans Twin C', 5, 14, 1000, 'monthly')
         returning id, created_at`,
      );
      await client.query('commit');
      expect(new Set(rows.map((row) => row.created_at.getTime())).size).toBe(1);
      sameMoment = rows
        .map((row) => row.id as string)
        .sort()
        .reverse();
    } finally {
      client.release();
    }

    const seen = (await walk(1)).map((plan) => plan.id);
    expect(new Set(seen).size).toBe(seen.length);
    const at = seen.indexOf(sameMoment[0] ?? '');
    expect(seen.slice(at, at + 3)).toEqual(sameMoment);
  });

  it('refuses a cursor issued for the old order by name (R11.9)', async () => {
    const [plan] = (await as(omar).get('/operator/plans?limit=1')).body.data;
    const nameCursor = encodeCursor([plan.name.toLowerCase(), plan.id], fingerprintOf('plans', {}));
    const res = await as(omar).get(`/operator/plans?cursor=${nameCursor}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'cursor', code: 'invalid_cursor' }]);
  });

  it('pages the plans with the total on every page and no cursor at the end', async () => {
    for (const name of ['Plans Page A', 'Plans Page B', 'Plans Page C']) {
      await as(omar).post('/operator/plans', { ...basic, name });
    }
    const own = (names: string[]) => names.filter((name) => name.startsWith('Plans '));
    const all = await listAll<PlanItemType>(app, omar, '/operator/plans');
    const expected = own(all.items.map((p) => p.name));
    expect(expected.length).toBeGreaterThan(2);

    const seen: string[] = [];
    let cursor = '';
    for (;;) {
      const res = await as(omar).get(`/operator/plans?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBeGreaterThanOrEqual(expected.length);
      seen.push(...res.body.data.map((p: PlanItemType) => p.name));
      if (!res.body.page.nextCursor) {
        break;
      }
      cursor = res.body.page.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(own(seen)).toEqual(expected);
  });

  it('refuses a bad limit and a cursor from another list or a broken one', async () => {
    for (const [limit, code] of [
      ['0', 'too_small'],
      ['101', 'too_big'],
      ['abc', 'invalid_type'],
    ]) {
      const res = await as(omar).get(`/operator/plans?limit=${limit}`);
      expect(res.body.error.details).toEqual([{ path: 'limit', code }]);
    }
    const tenants = await as(omar).get('/operator/tenants?limit=1');
    for (const cursor of [tenants.body.page.nextCursor, 'broken']) {
      const res = await as(omar).get(`/operator/plans?cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'cursor', code: 'invalid_cursor' }]);
    }
  });

  it('returns one plan, and 404 for an unknown id or a non-UUID', async () => {
    const created = await as(omar).post('/operator/plans', { ...basic, name: 'Plans View' });
    const res = await as(omar).get(`/operator/plans/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Plans View');
    expect(res.body.data.discountedPriceHalalas).toBe(85_000);
    const listed = (await listAll<{ id: string; discountedPriceHalalas: number }>(app, omar, '/operator/plans')).items.find((plan) => plan.id === created.body.data.id);
    expect(listed?.discountedPriceHalalas).toBe(85_000);
    expect((await as(omar).get('/operator/plans/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await as(omar).get('/operator/plans/not-a-uuid')).status).toBe(404);
  });
});

describe('edit a plan (R1.1, R1.14)', () => {
  it('changes price and discount and audits before and after', async () => {
    const created = await as(omar).post('/operator/plans', { ...basic, name: 'Plans Edit' });
    const id = created.body.data.id;
    const res = await as(omar).patch(`/operator/plans/${id}`, {
      priceHalalas: 120_000,
      discountPercent: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      priceHalalas: 120_000,
      discountPercent: 10,
      discountedPriceHalalas: 108_000,
      userLimit: 10,
      storageLimitGb: 10,
    });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.body.data.updatedAt).getTime());

    const audit = await auditFor(id);
    expect(audit.map((a) => a.action)).toEqual(['plan.created', 'plan.updated']);
    expect(audit[1]).toMatchObject({
      tenant_id: null,
      actor_id: omarId,
      details: {
        before: { priceHalalas: 100_000, discountPercent: 15 },
        after: { priceHalalas: 120_000, discountPercent: 10 },
      },
    });
    expect(audit[1].details.before).not.toHaveProperty('discountedPriceHalalas');
    expect(audit[1].details.after).not.toHaveProperty('discountedPriceHalalas');
  });

  it('refuses renaming to an existing name, an empty change, invalid values, and unknown ids', async () => {
    const created = await as(omar).post('/operator/plans', { ...basic, name: 'Plans Rename' });
    const id = created.body.data.id;
    const taken = await as(omar).patch(`/operator/plans/${id}`, { name: 'PLANS BASIC' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('TAKEN');
    expect(taken.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
    expect((await as(omar).patch(`/operator/plans/${id}`, {})).status).toBe(400);
    expect((await as(omar).patch(`/operator/plans/${id}`, { discountPercent: 100.5 })).status).toBe(400);
    expect(
      (
        await as(omar).patch('/operator/plans/00000000-0000-4000-8000-000000000000', {
          graceDays: 1,
        })
      ).status,
    ).toBe(404);
    expect((await as(omar).patch('/operator/plans/not-a-uuid', { graceDays: 1 })).status).toBe(404);
    expect((await auditFor(id)).map((a) => a.action)).toEqual(['plan.created']);
  });
});

describe('plan permissions (R1.15, R1.16)', () => {
  it('refuses a tenant user on every plan route with 403, and an anonymous caller with 401', async () => {
    const created = await as(omar).post('/operator/plans', { ...basic, name: 'Plans Guarded' });
    const id = created.body.data.id;
    const responses = await Promise.all([
      as(sara).post('/operator/plans', { ...basic, name: 'Plans Sara' }),
      as(sara).get('/operator/plans'),
      as(sara).get(`/operator/plans/${id}`),
      as(sara).patch(`/operator/plans/${id}`, { graceDays: 1 }),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await request(app).get('/operator/plans')).status).toBe(401);
  });
});
