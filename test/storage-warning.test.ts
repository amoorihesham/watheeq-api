import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, seedRole, seedSubscribedTenant } from './helpers/db.js';
import { seedFiles, uploadAs } from './helpers/files.js';
import { connectToTestStore } from './helpers/storage.js';

// Phase 7 spec, R7.14 and section 5: the storage warning at 90% of the limit, re-armed once usage is seen below 80%.

const PASSWORD = 'correct horse battery staple';
const GB = 1_073_741_824;
const pool = connectToTestDb();
const store = connectToTestStore();
const app = testApp(pool, createLogger('silent'), { fileStore: store });

let passwordHash = '';
let counter = 0;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await pool.end();
});

/** A tenant with a 1 GB limit holding `usedBytes`, with two holders of subscription.view and an uploader without it. */
async function tenantUsing(usedBytes: number) {
  const slug = `storage-warn-${++counter}`;
  const tenant = await seedSubscribedTenant(pool, slug, [
    { email: `sara@${slug}.test`, passwordHash },
    { email: `majed@${slug}.test`, passwordHash },
    { email: `khalid@${slug}.test`, passwordHash },
    { email: `nora@${slug}.test`, passwordHash },
    { email: `seeder@${slug}.test`, passwordHash },
  ]);
  const [sara = '', majed = '', khalid = '', nora = '', seeder = ''] = tenant.userIds;
  const viewer = await seedRole(pool, tenant.id, {
    name: 'Finance Lead',
    permissions: [{ key: 'subscription.view', scope: 'organization' }],
  });
  await pool.query('update tenant_members set role_id = $2 where user_id = $1', [majed, viewer]);
  await pool.query('update subscriptions set storage_limit_gb = 1 where tenant_id = $1', [tenant.id]);
  await setUsage(tenant.id, seeder, usedBytes);
  const access = async (person: string) => (await login(app, `${person}@${slug}.test`, PASSWORD)).access;
  return { tenantId: tenant.id, sara, majed, khalid, nora, seeder, access };
}

/** Replaces the tenant's seeded usage with files totalling `usedBytes` (a file holds at most 25 MiB). */
async function setUsage(tenantId: string, userId: string, usedBytes: number) {
  const chunk = 26_214_400;
  await pool.query('delete from files where tenant_id = $1', [tenantId]);
  const whole = Math.floor(usedBytes / chunk);
  if (whole > 0) {
    await seedFiles(pool, { tenantId, userId, count: whole, sizeBytes: chunk });
  }
  if (usedBytes % chunk > 0) {
    await seedFiles(pool, { tenantId, userId, count: 1, sizeBytes: usedBytes % chunk });
  }
}

const upload = async (access: string, bytes: number, name = `f${Math.random()}.txt`) => {
  const res = await uploadAs(app, access, name, Buffer.alloc(bytes, 'a'));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
};

const warnings = (tenantId: string) =>
  pool
    .query<{ user_id: string; data: Record<string, unknown>; request_id: string | null }>("select user_id, data, request_id from notifications where tenant_id = $1 and kind = 'storage.nearly_full' order by created_at, id", [tenantId])
    .then((result) => result.rows);

const noticeRows = (tenantId: string) => pool.query<{ key: string }>("select key from tenant_notices where tenant_id = $1 and kind = 'storage_nearly_full'", [tenantId]).then((result) => result.rows);

const MB = 1024 * 1024;

describe('the warning at 90% (R7.14)', () => {
  it('tells the holders of subscription.view when an upload takes usage to 90% or more, once', async () => {
    const t = await tenantUsing(Math.floor(0.9 * GB) - 500 * 1024);
    await upload(await t.access('khalid'), MB);

    const sent = await warnings(t.tenantId);
    expect(sent.map((row) => row.user_id).sort()).toEqual([t.sara, t.majed].sort());
    expect(sent[0]).toMatchObject({
      request_id: null,
      data: { usedBytes: Math.floor(0.9 * GB) - 500 * 1024 + MB, limitBytes: GB },
    });
    expect(await noticeRows(t.tenantId)).toEqual([{ key: '' }]);

    await upload(await t.access('khalid'), MB);
    await upload(await t.access('nora'), MB);
    expect(await warnings(t.tenantId)).toHaveLength(2);
  }, 60_000);

  it('does not warn below 90%, and warns at the first byte that reaches it', async () => {
    // 90% of 1 GiB is 966,367,641.6 bytes.
    const t = await tenantUsing(966_367_640);
    const khalid = await t.access('khalid');
    await upload(khalid, 1);
    expect(await warnings(t.tenantId)).toEqual([]);
    await upload(khalid, 1);
    expect(await warnings(t.tenantId)).toHaveLength(2);
  }, 60_000);

  it('does not tell the uploader who holds no permission, and does tell a holder who uploads', async () => {
    const t = await tenantUsing(Math.floor(0.9 * GB) - 1024);
    await upload(await t.access('sara'), MB);
    expect((await warnings(t.tenantId)).map((row) => row.user_id).sort()).toEqual([t.sara, t.majed].sort());
  }, 60_000);

  it('sends one warning when two uploads cross the line at the same time', async () => {
    const t = await tenantUsing(Math.floor(0.9 * GB) - 1);
    const [khalid, nora] = [await t.access('khalid'), await t.access('nora')];
    const [a, b] = await Promise.all([uploadAs(app, khalid, 'a.txt', Buffer.alloc(MB, 'a')), uploadAs(app, nora, 'b.txt', Buffer.alloc(MB, 'b'))]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await warnings(t.tenantId)).toHaveLength(2);
    expect(await noticeRows(t.tenantId)).toHaveLength(1);
  }, 60_000);

  it('does not warn when an upload is refused for passing the limit', async () => {
    const t = await tenantUsing(GB - 100);
    const res = await uploadAs(app, await t.access('khalid'), 'over.txt', Buffer.alloc(MB, 'a'));
    expect(res.status).toBe(409);
    expect(await warnings(t.tenantId)).toEqual([]);
    expect(await noticeRows(t.tenantId)).toEqual([]);
  }, 60_000);
});

describe('re-arming below 80% (Q10)', () => {
  it('warns again only after an upload has seen usage below 80%', async () => {
    const t = await tenantUsing(Math.floor(0.9 * GB));
    const khalid = await t.access('khalid');
    await upload(khalid, MB);
    expect(await warnings(t.tenantId)).toHaveLength(2);

    // Cleanup down to 85%: hovering near the line does not re-arm it.
    await setUsage(t.tenantId, t.seeder, Math.floor(0.85 * GB));
    await upload(khalid, MB);
    await setUsage(t.tenantId, t.seeder, Math.floor(0.9 * GB));
    await upload(khalid, MB);
    expect(await warnings(t.tenantId)).toHaveLength(2);
    expect(await noticeRows(t.tenantId)).toHaveLength(1);

    // A real cleanup: an upload at 15% re-arms it, and the next crossing warns again.
    await setUsage(t.tenantId, t.seeder, Math.floor(0.15 * GB));
    await upload(khalid, MB);
    expect(await noticeRows(t.tenantId)).toEqual([]);
    await setUsage(t.tenantId, t.seeder, Math.floor(0.9 * GB));
    await upload(khalid, MB);
    expect(await warnings(t.tenantId)).toHaveLength(4);
    expect(await noticeRows(t.tenantId)).toHaveLength(1);
  }, 120_000);

  it('re-arms at the exact 80% boundary: below it does, at it does not', async () => {
    // 80% of 1 GiB is 858,993,459.2 bytes.
    const t = await tenantUsing(Math.floor(0.9 * GB));
    const khalid = await t.access('khalid');
    await upload(khalid, MB);
    expect(await noticeRows(t.tenantId)).toHaveLength(1);

    await setUsage(t.tenantId, t.seeder, 858_993_460);
    await upload(khalid, 1);
    expect(await noticeRows(t.tenantId)).toHaveLength(1);

    await setUsage(t.tenantId, t.seeder, 858_993_459);
    await upload(khalid, 1);
    expect(await noticeRows(t.tenantId)).toEqual([]);
  }, 60_000);
});
