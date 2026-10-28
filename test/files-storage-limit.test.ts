import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, seedUser } from './helpers/db.js';
import { filesOf, fixture, seedFiles, uploadAs } from './helpers/files.js';
import { listAll } from './helpers/list-all.js';
import { connectToTestStore } from './helpers/storage.js';

// Phase 5.5 spec, R5.5.17-R5.5.21: the storage limit on plans and subscriptions, and storage usage in both views.

const PASSWORD = 'correct horse battery staple';
const GB = 1024 ** 3;
const pool = connectToTestDb();
const store = connectToTestStore();
const app = testApp(pool, createLogger('silent'), { fileStore: store });

let omar = '';
let today = '';
let counter = 0;

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', accessCookie(access)),
  post: (path: string, body: object) => request(app).post(path).set('Cookie', accessCookie(access)).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set('Cookie', accessCookie(access)).send(body),
  put: (path: string, body: object) => request(app).put(path).set('Cookie', accessCookie(access)).send(body),
});

const planBody = (name: string, storageLimitGb: number) => ({
  name,
  userLimit: 50,
  storageLimitGb,
  graceDays: 14,
  priceHalalas: 100_000,
  paymentPeriod: 'monthly',
});

const createPlan = async (name: string, storageLimitGb: number): Promise<string> => (await as(omar).post('/operator/plans', planBody(name, storageLimitGb))).body.data.id;

/** Al-Noor through the real API, so its subscription copies the plan as production does. */
async function createTenant(planId: string) {
  const slug = `limit-${++counter}`;
  const res = await as(omar).post('/operator/tenants', {
    name: `Tenant ${slug}`,
    slug,
    admin: { email: `sara@${slug}.test`, userName: 'Sara' },
    subscription: { planId, startDate: today, endDate: today },
  });
  expect(res.status).toBe(201);
  const tenantId: string = res.body.data.tenant.id;
  // The owner sets no password through the API here: give them one so they can log in.
  await pool.query('update users set password_hash = $2, email_verified_at = now() where email = $1', [`sara@${slug}.test`, await hashPassword(PASSWORD)]);
  const sara = (await login(app, `sara@${slug}.test`, PASSWORD)).access;
  const { rows } = await pool.query('select owner_id from tenants where id = $1', [tenantId]);
  return { tenantId, sara, ownerId: rows[0].owner_id as string, create: res };
}

beforeAll(async () => {
  await seedUser(pool, {
    email: 'omar@limit-watheeq.test',
    passwordHash: await hashPassword(PASSWORD),
    role: 'operator',
  });
  omar = (await login(app, 'omar@limit-watheeq.test', PASSWORD)).access;
  today = (await pool.query("select (now() at time zone 'Asia/Riyadh')::date::text as today")).rows[0].today;
});

afterAll(async () => {
  await pool.end();
});

describe('plans carry a storage limit (R5.5.17)', () => {
  it('creates a plan with storageLimitGb and returns it', async () => {
    const res = await as(omar).post('/operator/plans', planBody('Limit Business', 20));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userLimit: 50, storageLimitGb: 20 });
    const got = await as(omar).get(`/operator/plans/${res.body.data.id}`);
    expect(got.body.data.storageLimitGb).toBe(20);
    const list = await listAll<{ name: string }>(app, omar, '/operator/plans');
    expect(list.items.find((p) => p.name === 'Limit Business')).toMatchObject({
      storageLimitGb: 20,
    });
  });

  it('requires it on create, as a whole number of GB from 1 to 100,000', async () => {
    const { storageLimitGb: _omitted, ...without } = planBody('Limit Missing', 1);
    const missing = await as(omar).post('/operator/plans', without);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual([{ path: 'storageLimitGb', code: 'invalid_type' }]);
    for (const [name, value] of [
      ['zero', 0],
      ['negative', -5],
      ['too large', 100_001],
      ['fractional', 1.5],
      ['text', '10'],
    ] as const) {
      const res = await as(omar).post('/operator/plans', planBody(`Limit Bad ${name}`, value as number));
      expect(res.status, name).toBe(400);
      expect(res.body.error.details[0].path).toBe('storageLimitGb');
    }
    expect((await as(omar).post('/operator/plans', planBody('Limit Min', 1))).status).toBe(201);
    expect((await as(omar).post('/operator/plans', planBody('Limit Max', 100_000))).status).toBe(201);
  });

  it('allows it on update, and audits the change', async () => {
    const planId = await createPlan('Limit Updatable', 5);
    const res = await as(omar).patch(`/operator/plans/${planId}`, { storageLimitGb: 8 });
    expect(res.status).toBe(200);
    expect(res.body.data.storageLimitGb).toBe(8);
    const bad = await as(omar).patch(`/operator/plans/${planId}`, { storageLimitGb: 0 });
    expect(bad.status).toBe(400);
    const { rows } = await pool.query("select details from audit_log where resource_id = $1 and action = 'plan.updated'", [planId]);
    expect(rows[0].details.before.storageLimitGb).toBe(5);
    expect(rows[0].details.after.storageLimitGb).toBe(8);
  });
});

describe('a subscription copies the limit (R5.5.17)', () => {
  it('copies 20 GB for Al-Noor, and a later plan change does not touch it', async () => {
    const planId = await createPlan('Limit Copy Business', 20);
    const { tenantId, create } = await createTenant(planId);
    expect(create.body.data.subscription.storageLimitGb).toBe(20);
    await as(omar).patch(`/operator/plans/${planId}`, { storageLimitGb: 30 });
    const view = await as(omar).get(`/operator/tenants/${tenantId}`);
    expect(view.body.data.subscription.storageLimitGb).toBe(20);
    expect(view.body.data.usage.storage.limitBytes).toBe(20 * GB);
  });

  it("copies the plan's current limit again when the subscription is changed", async () => {
    const small = await createPlan('Limit Copy Small', 5);
    const large = await createPlan('Limit Copy Large', 40);
    const { tenantId } = await createTenant(small);
    const res = await as(omar).put(`/operator/tenants/${tenantId}/subscription`, {
      planId: large,
      startDate: today,
      endDate: today,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.storageLimitGb).toBe(40);
    expect(res.body.data.usage.storage).toEqual({
      usedBytes: 0,
      limitBytes: 40 * GB,
      overLimit: false,
    });
    const { rows } = await pool.query("select details from audit_log where tenant_id = $1 and action = 'subscription.changed'", [tenantId]);
    expect(rows[0].details.before.storageLimitGb).toBe(5);
    expect(rows[0].details.after.storageLimitGb).toBe(40);
  });

  it('rejects a limit outside 1 to 100,000 in the database too', async () => {
    await expect(pool.query("update plans set storage_limit_gb = 0 where name = 'Limit Business'")).rejects.toThrow('plans_storage_limit');
    const { rows } = await pool.query('select tenant_id from subscriptions limit 1');
    await expect(pool.query('update subscriptions set storage_limit_gb = 100001 where tenant_id = $1', [rows[0].tenant_id])).rejects.toThrow('subscriptions_storage_limit');
  });

  it('gives plans and subscriptions that existed before the limit 10 GB', async () => {
    const { rows } = await pool.query("select column_default from information_schema.columns where table_name in ('plans','subscriptions') and column_name = 'storage_limit_gb'");
    expect(rows.map((r) => r.column_default)).toEqual(['10', '10']);
  });
});

describe('usage in both views (R5.5.18, R5.5.21)', () => {
  it('sums every stored byte in every state: pending, attached, uploading, and discarded', async () => {
    const { tenantId, sara, ownerId } = await createTenant(await createPlan('Limit Usage', 20));
    for (const state of ['pending', 'attached', 'uploading', 'discarded'] as const) {
      await seedFiles(pool, { tenantId, userId: ownerId, count: 1, state, sizeBytes: 1_000_000 });
    }
    const expected = { usedBytes: 4_000_000, limitBytes: 20 * GB, overLimit: false };
    const mine = await as(sara).get('/subscription');
    expect(mine.status).toBe(200);
    expect(mine.body.data.subscription.storageLimitGb).toBe(20);
    expect(mine.body.data.usage).toEqual({
      activeUsers: 1,
      userLimit: 50,
      overLimit: false,
      storage: expected,
    });
    const operatorView = await as(omar).get(`/operator/tenants/${tenantId}`);
    expect(operatorView.body.data.usage.storage).toEqual(expected);
    const list = await listAll<{ tenant: { id: string }; usage: { storage: unknown } }>(app, omar, '/operator/tenants');
    const row = list.items.find((t) => t.tenant.id === tenantId);
    expect(row?.usage.storage).toEqual(expected);
  });

  it("counts only the tenant's own files", async () => {
    const a = await createTenant(await createPlan('Limit Usage A', 20));
    const b = await createTenant(await createPlan('Limit Usage B', 20));
    await seedFiles(pool, { tenantId: a.tenantId, userId: a.ownerId, count: 3, sizeBytes: 1000 });
    expect((await as(b.sara).get('/subscription')).body.data.usage.storage.usedBytes).toBe(0);
    expect((await as(a.sara).get('/subscription')).body.data.usage.storage.usedBytes).toBe(3000);
  });

  it('counts a real upload at its size', async () => {
    const { sara } = await createTenant(await createPlan('Limit Real', 20));
    const bytes = fixture('contract.pdf');
    const res = await uploadAs(app, sara, 'draft.pdf', bytes);
    expect(res.status).toBe(201);
    expect((await as(sara).get('/subscription')).body.data.usage.storage.usedBytes).toBe(bytes.length);
  });
});

describe('a downgrade below the usage (R5.5.20)', () => {
  it('keeps every file, refuses uploads, shows overLimit, and allows uploads again once usage falls under', async () => {
    const big = await createPlan('Limit Downgrade Big', 20);
    const small = await createPlan('Limit Downgrade Small', 10);
    const { tenantId, sara, ownerId } = await createTenant(big);
    // About 18 GB: 18 * 2^30 bytes in 25 MB files.
    const files = Math.ceil((18 * GB) / 26_214_400);
    await seedFiles(pool, {
      tenantId,
      userId: ownerId,
      count: files,
      sizeBytes: 26_214_400,
      state: 'attached',
    });
    const used = files * 26_214_400;
    expect((await uploadAs(app, sara, 'before.pdf', fixture('contract.pdf'))).status).toBe(201);

    const res = await as(omar).put(`/operator/tenants/${tenantId}/subscription`, {
      planId: small,
      startDate: today,
      endDate: today,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.usage.storage).toEqual({
      usedBytes: used + fixture('contract.pdf').length,
      limitBytes: 10 * GB,
      overLimit: true,
    });
    expect((await filesOf(pool, tenantId)).length).toBe(files + 1);

    const refused = await uploadAs(app, sara, 'after.pdf', fixture('contract.pdf'));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('STORAGE_LIMIT_REACHED');
    // The rest of the API keeps working.
    expect((await as(sara).get('/subscription')).status).toBe(200);

    // Usage falls under the limit: 8 GB of the files go away.
    await pool.query(
      `delete from files where id in (
         select id from files where tenant_id = $1 and size_bytes = 26214400 order by id limit $2)`,
      [tenantId, Math.ceil((8.1 * GB) / 26_214_400)],
    );
    const view = await as(sara).get('/subscription');
    expect(view.body.data.usage.storage.overLimit).toBe(false);
    expect((await uploadAs(app, sara, 'now-fits.pdf', fixture('contract.pdf'))).status).toBe(201);
  }, 60_000);
});
