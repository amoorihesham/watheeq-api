import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor, fingerprintOf } from '../src/http/list.js';
import { createLogger } from '../src/logging/logger.js';
import { PERMISSION_CATALOG, TENANT_PERMISSIONS } from '../src/modules/tenant-access/index.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser, waitUntilBlockedOn } from './helpers/db.js';

const PASSWORD = 'correct horse battery staple';
const SARA = 'sara@rl-alnoor.test';
const HUDA = 'huda@rl-alnoor.test';
const FAISAL = 'faisal@rl-alnoor.test';
const KHALID = 'khalid@rl-alnoor.test';
const RASHID = 'admin@rl-alrashid.test';

const pool = connectToTestDb();
const app = testApp(pool, createLogger('silent'));

let alNoor = '';
let adminRoleId = '';
let headOfLegal = '';
let sectionLead = '';
let financeAdmin = '';
let rashidRole = '';
let sara = '';
let huda = '';
let faisal = '';
let khalid = '';
let rashid = '';
let hudaId = '';
let counter = 0;

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', accessCookie(access)),
  post: (path: string, body: object = {}) => request(app).post(path).set('Cookie', accessCookie(access)).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set('Cookie', accessCookie(access)).send(body),
  delete: (path: string) => request(app).delete(path).set('Cookie', accessCookie(access)),
});

const org = (key: string) => ({ key, scope: 'organization' });
const nextName = (prefix = 'Role') => `${prefix} ${++counter}`;

/** Creates a role as Sara through the API; returns its id. */
async function createRole(permissions: object[] = [], name = nextName()): Promise<string> {
  const res = await as(sara).post('/roles', { name, permissions });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

/** A member of Al-Noor holding `roleId`, signed in; returns their id and access token. */
async function memberWith(roleId: string): Promise<{ id: string; access: string }> {
  const address = `member${++counter}@rl-alnoor.test`;
  const id = await seedUser(pool, { email: address, passwordHash: await hashPassword(PASSWORD) });
  await pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [alNoor, id, roleId]);
  return { id, access: (await login(app, address, PASSWORD)).access };
}

const auditOf = (resourceId: string) => pool.query('select action, tenant_id, actor_id, details from audit_log where resource_id = $1 order by id', [resourceId]).then((result) => result.rows);

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, 'rl-al-noor', [
    { email: SARA, passwordHash },
    { email: KHALID, passwordHash },
  ]);
  ({ id: alNoor, adminRoleId } = tenant);
  headOfLegal = await seedRole(pool, alNoor, {
    name: 'Head of Legal',
    permissions: [org('org.view'), org('user.view'), org('role.view'), org('role.manage'), org('role.assign')],
  });
  sectionLead = await seedRole(pool, alNoor, {
    name: 'Section Lead',
    permissions: [org('role.manage'), { key: 'user.view', scope: 'section' }],
  });
  financeAdmin = await seedRole(pool, alNoor, {
    name: 'Finance Admin',
    permissions: [org('org.view'), org('user.deactivate')],
  });
  for (const [address, roleId] of [
    [HUDA, headOfLegal],
    [FAISAL, sectionLead],
  ] as const) {
    const id = await seedUser(pool, { email: address, passwordHash });
    await pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [alNoor, id, roleId]);
    if (address === HUDA) {
      hudaId = id;
    }
  }
  ({ memberRoleId: rashidRole } = await seedSubscribedTenant(pool, 'rl-al-rashid', [{ email: RASHID, passwordHash }]));
  sara = (await login(app, SARA, PASSWORD)).access;
  huda = (await login(app, HUDA, PASSWORD)).access;
  faisal = (await login(app, FAISAL, PASSWORD)).access;
  khalid = (await login(app, KHALID, PASSWORD)).access;
  rashid = (await login(app, RASHID, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe('the permission catalog (R3.1)', () => {
  it('lists every permission with the scopes it allows, in catalog order', async () => {
    const res = await as(huda).get('/permissions?limit=100');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual(TENANT_PERMISSIONS.map((key) => ({ key, scopes: PERMISSION_CATALOG[key] })));
    expect(res.body.page).toEqual({ nextCursor: null, total: TENANT_PERMISSIONS.length });
    expect(res.body.data.find((p: { key: string }) => p.key === 'user.view')).toEqual({
      key: 'user.view',
      scopes: ['own', 'section', 'department', 'organization'],
    });
  });

  it('pages the catalog in catalog order, 25 at a time by default', async () => {
    const first = await as(huda).get('/permissions');
    expect(first.body.data.map((p: { key: string }) => p.key)).toEqual(TENANT_PERMISSIONS.slice(0, 25));
    expect(first.body.page).toEqual({
      nextCursor: expect.any(String),
      total: TENANT_PERMISSIONS.length,
    });
    const second = await as(huda).get(`/permissions?cursor=${first.body.page.nextCursor}`);
    expect(second.body.data.map((p: { key: string }) => p.key)).toEqual(TENANT_PERMISSIONS.slice(25));
    expect(second.body.page.nextCursor).toBeNull();
  });

  it("refuses a cursor naming a permission the catalog no longer has, another list's cursor, and a broken one", async () => {
    const stale = encodeCursor(['gone.permission'], fingerprintOf('permissions', {}));
    const roles = await as(huda).get('/roles?limit=1');
    for (const cursor of [stale, roles.body.page.nextCursor, 'broken']) {
      const res = await as(huda).get(`/permissions?cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'cursor', code: 'invalid_cursor' }]);
    }
    expect((await as(huda).get('/permissions?limit=0')).body.error.details).toEqual([{ path: 'limit', code: 'too_small' }]);
  });

  it('requires role.view', async () => {
    expect((await as(khalid).get('/permissions')).status).toBe(403);
  });
});

describe('listing and viewing roles', () => {
  it('shows the Tenant Admin with every permission at its widest scope, and its holders', async () => {
    const res = await as(huda).get(`/roles/${adminRoleId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: adminRoleId,
      name: 'Tenant Admin',
      isSystem: true,
      permissions: TENANT_PERMISSIONS.map((key) => ({
        key,
        scope: PERMISSION_CATALOG[key].at(-1),
      })),
      memberCount: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("lists the tenant's roles by name with their grants and member counts", async () => {
    const res = await as(huda).get('/roles');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.map((role: { name: string }) => [role.name, role]));
    expect(byName['Head of Legal']).toMatchObject({
      isSystem: false,
      memberCount: 1,
      permissions: ['org.view', 'user.view', 'role.view', 'role.manage', 'role.assign'].map(org),
    });
    expect(byName['Section Lead'].permissions).toEqual([{ key: 'user.view', scope: 'section' }, org('role.manage')]);
    const names = res.body.data.map((role: { name: string }) => role.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b, 'und', { sensitivity: 'base' })));
    expect(names).not.toContain('Member (Al-Rashid)');
  });

  it('pages the roles by name, with the total on every page and no cursor at the end', async () => {
    const all = await as(huda).get('/roles?limit=100');
    const names = all.body.data.map((role: { name: string }) => role.name);
    expect(all.body.page).toEqual({ nextCursor: null, total: names.length });
    expect(names.length).toBeGreaterThan(3);

    const seen: string[] = [];
    let cursor = '';
    for (;;) {
      const res = await as(huda).get(`/roles?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.body.page.total).toBe(names.length);
      seen.push(...res.body.data.map((role: { name: string }) => role.name));
      if (!res.body.page.nextCursor) {
        break;
      }
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toEqual(names);
    expect((await as(huda).get('/roles?limit=101')).body.error.details).toEqual([{ path: 'limit', code: 'too_big' }]);
  });

  it("never shows another tenant's roles (R3.18)", async () => {
    const res = await as(rashid).get('/roles');
    expect(res.body.data.map((role: { id: string }) => role.id)).not.toContain(headOfLegal);
    for (const id of [headOfLegal, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      expect((await as(rashid).get(`/roles/${id}`)).status).toBe(404);
      expect((await as(rashid).patch(`/roles/${id}`, { name: 'Taken' })).status).toBe(404);
      expect((await as(rashid).delete(`/roles/${id}`)).status).toBe(404);
    }
  });

  it('requires role.view', async () => {
    expect((await as(khalid).get('/roles')).status).toBe(403);
    expect((await as(khalid).get(`/roles/${adminRoleId}`)).status).toBe(403);
  });
});

describe('creating a role (R3.4, R3.5)', () => {
  it('creates a role with scoped grants, in catalog order, and audits it', async () => {
    const res = await as(sara).post('/roles', {
      name: '  Legal Staff  ',
      permissions: [{ key: 'user.view', scope: 'department' }, org('org.view')],
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const grants = [org('org.view'), { key: 'user.view', scope: 'department' }];
    expect(res.body.data).toMatchObject({
      name: 'Legal Staff',
      isSystem: false,
      permissions: grants,
      memberCount: 0,
    });
    expect((await as(sara).get(`/roles/${res.body.data.id}`)).body.data.permissions).toEqual(grants);
    expect(await auditOf(res.body.data.id)).toMatchObject([
      {
        action: 'role.created',
        tenant_id: alNoor,
        details: { name: 'Legal Staff', isSystem: false, permissions: grants },
      },
    ]);
  });

  it('allows a role with no permissions', async () => {
    const res = await as(sara).post('/roles', { name: nextName('Requester'), permissions: [] });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual([]);
  });

  it('reports each unknown permission, duplicate, and disallowed scope', async () => {
    const res = await as(sara).post('/roles', {
      name: nextName(),
      permissions: [org('org.view'), org('request.approve'), { key: 'org.view', scope: 'own' }, { key: 'org.manage', scope: 'department' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'permissions.1.key', code: 'unknown_permission' },
      { path: 'permissions.2.key', code: 'duplicate_permission' },
      { path: 'permissions.3.scope', code: 'scope_not_allowed' },
    ]);
  });

  it('refuses a missing or too long name, an unknown scope, and missing permissions', async () => {
    const bodies = [{ name: '   ', permissions: [] }, { name: 'x'.repeat(101), permissions: [] }, { name: nextName(), permissions: [{ key: 'org.view', scope: 'team' }] }, { name: nextName() }];
    for (const body of bodies) {
      expect((await as(sara).post('/roles', body)).status).toBe(400);
    }
  });

  it('keeps names unique ignoring case, Arabic included, but only within the tenant', async () => {
    await createRole([], 'مستشار قانوني');
    for (const name of ['مستشار قانوني', 'head of legal', 'TENANT ADMIN']) {
      const res = await as(sara).post('/roles', { name, permissions: [] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TAKEN');
      expect(res.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
    }
    expect((await as(rashid).post('/roles', { name: 'Head of Legal', permissions: [] })).status).toBe(201);
  });

  it('requires role.manage', async () => {
    const res = await as(khalid).post('/roles', { name: nextName(), permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('editing a role (R3.6)', () => {
  it('renames and replaces grants, auditing only what changed', async () => {
    const id = await createRole([org('org.view')], 'Before Edit');
    const res = await as(sara).patch(`/roles/${id}`, {
      name: 'After Edit',
      permissions: [{ key: 'user.view', scope: 'section' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'After Edit',
      permissions: [{ key: 'user.view', scope: 'section' }],
    });
    expect(Date.parse(res.body.data.updatedAt)).toBeGreaterThan(Date.parse(res.body.data.createdAt));
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: 'role.updated',
      details: {
        before: { name: 'Before Edit', permissions: [org('org.view')] },
        after: { name: 'After Edit', permissions: [{ key: 'user.view', scope: 'section' }] },
      },
    });

    await as(sara).patch(`/roles/${id}`, { name: 'Renamed Only' });
    expect((await auditOf(id)).at(-1).details).toEqual({
      before: { name: 'After Edit' },
      after: { name: 'Renamed Only' },
    });
  });

  it('writes no audit entry when nothing changes, whatever the order of the grants', async () => {
    const id = await createRole([org('org.view'), org('role.view')]);
    const before = (await auditOf(id)).length;
    const res = await as(sara).patch(`/roles/${id}`, {
      permissions: [org('role.view'), org('org.view')],
    });
    expect(res.status).toBe(200);
    expect((await auditOf(id)).length).toBe(before);
  });

  it('reaches holders at their next login or refresh (R3.6)', async () => {
    const id = await createRole([org('org.view')]);
    const holder = await memberWith(id);
    expect((await as(holder.access).get('/users')).status).toBe(403);
    await as(sara).patch(`/roles/${id}`, { permissions: [org('org.view'), org('user.view')] });
    const address = (await pool.query('select email from users where id = $1', [holder.id])).rows[0].email;
    const fresh = (await login(app, address, PASSWORD)).access;
    expect((await as(fresh).get('/users')).status).toBe(200);
  });

  it('never edits the Tenant Admin role (R3.2)', async () => {
    for (const body of [{ name: 'Boss' }, { permissions: [] }]) {
      const res = await as(sara).patch(`/roles/${adminRoleId}`, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROLE_PROTECTED');
    }
  });

  it('refuses an empty body and a taken name', async () => {
    const id = await createRole();
    expect((await as(sara).patch(`/roles/${id}`, {})).status).toBe(400);
    const res = await as(sara).patch(`/roles/${id}`, { name: 'Head Of Legal' });
    expect(res.body.error.code).toBe('TAKEN');
    expect(res.body.error.details).toEqual([{ path: 'name', code: 'taken' }]);
  });
});

describe('deleting a role (R3.7)', () => {
  it('deletes an unused role with its grants, and audits it', async () => {
    const id = await createRole([org('org.view')], 'Short Lived');
    expect((await as(sara).delete(`/roles/${id}`)).status).toBe(204);
    expect((await as(sara).get(`/roles/${id}`)).status).toBe(404);
    const { rows } = await pool.query('select count(*)::int as n from role_permissions where role_id = $1', [id]);
    expect(rows[0].n).toBe(0);
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: 'role.deleted',
      details: { name: 'Short Lived', permissions: [org('org.view')] },
    });
  });

  it('refuses a role someone holds, even a deactivated user', async () => {
    const id = await createRole();
    const holder = await memberWith(id);
    await pool.query('update users set is_active = false where id = $1', [holder.id]);
    const res = await as(sara).delete(`/roles/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROLE_IN_USE');
  });

  it('never deletes the Tenant Admin role', async () => {
    const res = await as(sara).delete(`/roles/${adminRoleId}`);
    expect(res.body.error.code).toBe('ROLE_PROTECTED');
  });
});

describe('the subset rule (R3.8)', () => {
  it('lets Huda create a role within her grants, at the same or a narrower scope', async () => {
    const res = await as(huda).post('/roles', {
      name: nextName('Legal Staff'),
      permissions: [org('org.view'), { key: 'user.view', scope: 'department' }],
    });
    expect(res.status).toBe(201);
  });

  it('refuses a permission Huda does not hold, naming what she lacks', async () => {
    const res = await as(huda).post('/roles', {
      name: nextName(),
      permissions: [org('org.view'), org('user.create'), org('user.deactivate')],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_NOT_HELD');
    expect(res.body.error.details).toEqual([
      { path: 'permissions.1', code: 'permission_not_held' },
      { path: 'permissions.2', code: 'permission_not_held' },
    ]);
  });

  it.each([
    ['own', 201],
    ['section', 201],
    ['department', 403],
    ['organization', 403],
  ])('lets Faisal (user.view at section) grant user.view at %s: %i', async (scope, status) => {
    const res = await as(faisal).post('/roles', {
      name: nextName(),
      permissions: [{ key: 'user.view', scope }],
    });
    expect(res.status).toBe(status);
    if (status === 403) {
      expect(res.body.error.details).toEqual([{ path: 'permissions.0', code: 'permission_not_held' }]);
    }
  });

  it('refuses edits and deletes of a role holding more than Huda, even a rename', async () => {
    for (const body of [{ name: 'Renamed Finance' }, { permissions: [] }]) {
      const res = await as(huda).patch(`/roles/${financeAdmin}`, body);
      expect(res.status).toBe(403);
      expect(res.body.error.details).toEqual([]);
    }
    expect((await as(huda).delete(`/roles/${financeAdmin}`)).status).toBe(403);
    expect((await as(sara).get(`/roles/${financeAdmin}`)).body.data.name).toBe('Finance Admin');
  });

  it('lets Huda narrow her own role, but not widen it', async () => {
    const own = await createRole(['org.view', 'user.view', 'role.view', 'role.manage', 'role.assign'].map(org));
    const holder = await memberWith(own);
    const narrowed = await as(holder.access).patch(`/roles/${own}`, {
      permissions: ['org.view', 'role.view', 'role.manage'].map(org),
    });
    expect(narrowed.status).toBe(200);
    const widened = await as(holder.access).patch(`/roles/${own}`, {
      permissions: ['org.view', 'role.view', 'role.manage', 'user.create'].map(org),
    });
    expect(widened.status).toBe(403);
  });

  it("checks the actor's role as it is now, not as the token says (R3.12)", async () => {
    const lead = await createRole(['org.view', 'role.manage'].map(org));
    const holder = await memberWith(lead);
    expect((await as(holder.access).post('/roles', { name: nextName(), permissions: [] })).status).toBe(201);
    await as(sara).patch(`/roles/${lead}`, { permissions: [org('org.view')] });
    const res = await as(holder.access).post('/roles', { name: nextName(), permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'PERMISSION_NOT_HELD',
      details: [],
    });
  });

  it('gives a deactivated actor nothing, even with a live token', async () => {
    const holder = await memberWith(headOfLegal);
    await pool.query('update users set is_active = false where id = $1', [holder.id]);
    const res = await as(holder.access).post('/roles', { name: nextName(), permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_NOT_HELD');
  });
});

describe('concurrency (P3.5)', () => {
  it('makes an edit wait for a concurrent edit, then judge the role as that edit left it', async () => {
    // Sara is adding user.deactivate to Clerk while Huda empties it. Huda must not strip a power she
    // does not hold because she read Clerk before Sara committed.
    const clerk = await createRole([org('org.view')]);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from roles where id = $1 for update', [clerk]);
      await client.query('update roles set updated_at = now() where id = $1', [clerk]);
      await client.query("insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, 'user.deactivate', 'organization')", [alNoor, clerk]);
      const edit = as(huda)
        .patch(`/roles/${clerk}`, { permissions: [] })
        .then((res) => res);
      await waitUntilBlockedOn(pool, 'roles');
      await client.query('commit');
      const res = await edit;
      expect(res.status).toBe(403);
      expect(res.body.error.details).toEqual([]);
    } finally {
      client.release();
    }
    expect((await as(sara).get(`/roles/${clerk}`)).body.data.permissions).toEqual([org('org.view'), org('user.deactivate')]);
  });

  it('waits for an invitation into the role being deleted, then refuses the delete', async () => {
    const id = await createRole();
    const userId = await seedUser(pool, { email: `late${++counter}@rl-alnoor.test` });
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [alNoor, userId, id]);
      const deletion = as(sara)
        .delete(`/roles/${id}`)
        .then((res) => res);
      await waitUntilBlockedOn(pool, 'roles');
      await client.query('commit');
      const res = await deletion;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROLE_IN_USE');
    } finally {
      client.release();
    }
  });

  it('makes an invitation into a role deleted meanwhile fail with unknown_role', async () => {
    const id = await createRole();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from roles where id = $1 for update', [id]);
      const invitation = as(sara)
        .post('/users', {
          email: `orphan${++counter}@rl-alnoor.test`,
          userName: 'Orphan',
          roleId: id,
        })
        .then((res) => res);
      await waitUntilBlockedOn(pool, 'tenant_members');
      await client.query('delete from roles where id = $1', [id]);
      await client.query('commit');
      const res = await invitation;
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'roleId', code: 'unknown_role' }]);
    } finally {
      client.release();
    }
  });
});

describe('tenant isolation and subscription state', () => {
  it("refuses a grant on another tenant's role in the database, even if a query forgets the filter", async () => {
    await expect(pool.query("insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, 'role.view', 'organization')", [alNoor, rashidRole])).rejects.toThrow(/role_permissions_role_fk/);
  });

  it('refuses role writes in Read-only and still lists roles', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, 'rl-read-only', [{ email: 'admin@rl-read-only.test', passwordHash }]);
    await pool.query('update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1', [tenant.id]);
    const admin = (await login(app, 'admin@rl-read-only.test', PASSWORD)).access;
    const res = await as(admin).post('/roles', { name: 'Late', permissions: [] });
    expect(res.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect((await as(admin).get('/roles')).status).toBe(200);
  });

  it('records the actor of every role write', async () => {
    const res = await as(huda).post('/roles', { name: nextName(), permissions: [] });
    expect((await auditOf(res.body.data.id))[0].actor_id).toBe(hudaId);
  });
});
