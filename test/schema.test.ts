import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectToTestDb, rejectionText, type SeededTenant, seedRole, seedTenant, seedUser } from './helpers/db.js';

const pool = connectToTestDb();

let alNoor: SeededTenant;
let alRashid: SeededTenant;

beforeAll(async () => {
  alNoor = await seedTenant(pool, 'al-noor', [{ email: 'sara@alnoor.test' }]);
  alRashid = await seedTenant(pool, 'al-rashid', [{ email: 'nasser@alrashid.test' }, { email: 'khalid@alrashid.test' }]);
});

afterAll(async () => {
  await pool.end();
});

describe('database baseline', () => {
  it('creates every table', async () => {
    const { rows } = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(rows.map((r) => r.table_name)).toEqual([
      'audit_log',
      'calendar_period_overrides',
      'calendar_periods',
      'escalation_recipients',
      'escalation_settings',
      'files',
      'information_requests',
      'notifications',
      'number_sequences',
      'org_units',
      'password_tokens',
      'plans',
      'positions',
      'priorities',
      'refresh_tokens',
      'request_escalations',
      'request_files',
      'request_stage_assignees',
      'request_stage_runs',
      'requests',
      'role_permissions',
      'roles',
      'service_workflows',
      'services',
      'subscriptions',
      'tenant_members',
      'tenant_notices',
      'tenants',
      'users',
      'workflow_stages',
      'workflow_versions',
      'workflows',
      'working_hours',
    ]);
  });

  describe('files (Phase 5.5, 4.1)', () => {
    const insert = (state: string, extra: Record<string, unknown> = {}) => {
      const row = {
        content_type: 'application/pdf',
        sha256: 'abc',
        size_bytes: 100,
        name: 'a.pdf',
        attached_at: null as Date | null,
        ...extra,
      };
      return pool.query(
        `insert into files (tenant_id, uploaded_by, state, name, content_type, sha256, size_bytes, attached_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [alNoor.id, alNoor.userIds[0], state, row.name, row.content_type, row.sha256, row.size_bytes, row.attached_at],
      );
    };

    it('accepts an uploading row without a detected type and a pending row with one', async () => {
      await insert('uploading', { content_type: null, sha256: null });
      await insert('pending');
    });

    it('requires a detected type and digest once a file is no longer uploading', async () => {
      expect(await rejectionText(insert('pending', { content_type: null }))).toMatch(/files_detected/);
      expect(await rejectionText(insert('discarded', { sha256: null }))).toMatch(/files_detected/);
    });

    it('sets attached_at exactly when the file is attached', async () => {
      await insert('attached', { attached_at: new Date() });
      expect(await rejectionText(insert('attached'))).toMatch(/files_attached_at/);
      expect(await rejectionText(insert('pending', { attached_at: new Date() }))).toMatch(/files_attached_at/);
    });

    it('limits the size to 1 byte up to 25 MB and the name to 255 characters', async () => {
      expect(await rejectionText(insert('pending', { size_bytes: 0 }))).toMatch(/files_size/);
      expect(await rejectionText(insert('pending', { size_bytes: 26_214_401 }))).toMatch(/files_size/);
      await insert('pending', { size_bytes: 26_214_400 });
      expect(await rejectionText(insert('pending', { name: '' }))).toMatch(/files_name_length/);
      expect(await rejectionText(insert('pending', { name: 'a'.repeat(256) }))).toMatch(/files_name_length/);
    });

    it('is the target of composite foreign keys: (tenant_id, id) is unique', async () => {
      const { rows } = await pool.query("select conname from pg_constraint where conrelid = 'files'::regclass and contype = 'u'");
      expect(rows.map((r) => r.conname)).toContain('files_tenant_id_unique');
    });
  });

  it('refuses a second membership for a user (R0.8)', async () => {
    const khalid = alRashid.userIds[1];
    const err = await rejectionText(pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [alNoor.id, khalid, alNoor.memberRoleId]));
    expect(err).toMatch(/tenant_members_user_unique/);
  });

  it('requires a role for every membership (P3.2)', async () => {
    const userId = await seedUser(pool, { email: 'huda@alrashid.test' });
    const err = await rejectionText(pool.query('insert into tenant_members (tenant_id, user_id) values ($1, $2)', [alRashid.id, userId]));
    expect(err).toMatch(/null value in column "role_id"/);
  });

  it("refuses a membership holding another tenant's role", async () => {
    const userId = await seedUser(pool, { email: 'faisal@alrashid.test' });
    const err = await rejectionText(pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [alRashid.id, userId, alNoor.memberRoleId]));
    expect(err).toMatch(/tenant_members_role_fk/);
  });

  it('allows one system role per tenant (R3.2)', async () => {
    const err = await rejectionText(seedRole(pool, alNoor.id, { name: 'Second Admin', isSystem: true }));
    expect(err).toMatch(/roles_system_unique/);
  });

  it('keeps role names unique within a tenant, ignoring case (R3.5)', async () => {
    const err = await rejectionText(seedRole(pool, alNoor.id, { name: 'MEMBER' }));
    expect(err).toMatch(/roles_name_unique/);
    await expect(seedRole(pool, alRashid.id, { name: 'Contracts Clerk' })).resolves.toBeTruthy();
    await expect(seedRole(pool, alNoor.id, { name: 'Contracts Clerk' })).resolves.toBeTruthy();
  });

  it("refuses a malformed permission key and a grant on another tenant's role", async () => {
    const insertGrant = (tenantId: string, roleId: string, key: string) => pool.query("insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, $3, 'organization')", [tenantId, roleId, key]);
    expect(await rejectionText(insertGrant(alNoor.id, alNoor.memberRoleId, 'Org View'))).toMatch(/role_permissions_key_format/);
    expect(await rejectionText(insertGrant(alRashid.id, alNoor.memberRoleId, 'role.view'))).toMatch(/role_permissions_role_fk/);
  });

  it('refuses an email that is not lowercased and trimmed', async () => {
    const err = await rejectionText(seedUser(pool, { email: 'Sara@AlNoor.test' }));
    expect(err).toMatch(/users_email_normalized/);
  });

  it('refuses a duplicate email across tenants', async () => {
    const err = await rejectionText(seedUser(pool, { email: 'sara@alnoor.test' }));
    expect(err).toMatch(/users_email_unique/);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['untrimmed', ' Sara '],
    ['over 100 characters', 'x'.repeat(101)],
  ])('refuses a user_name that is %s', async (_label, userName) => {
    const err = await rejectionText(seedUser(pool, { email: `name-${userName.length}-${_label.length}@alnoor.test`, userName }));
    expect(err).toMatch(/users_user_name_length/);
  });

  it('accepts an Arabic user_name', async () => {
    await seedUser(pool, { email: 'arabic@alnoor.test', userName: 'سارة القحطاني' });
    const { rows } = await pool.query("select user_name from users where email = 'arabic@alnoor.test'");
    expect(rows[0].user_name).toBe('سارة القحطاني');
  });

  it('defaults a new account to the user role', async () => {
    const { rows } = await pool.query("select role from users where email = 'sara@alnoor.test'");
    expect(rows[0].role).toBe('user');
  });

  it('refuses a duplicate tenant slug', async () => {
    const err = await rejectionText(seedTenant(pool, 'al-noor', []));
    expect(err).toMatch(/tenants_slug_unique/);
  });

  const insertPlan = (overrides: Record<string, unknown>) => {
    const plan = {
      name: `Schema Plan ${Math.random()}`,
      user_limit: 10,
      grace_days: 14,
      price_halalas: 100000,
      payment_period: 'monthly',
      discount_percent: 0,
      ...overrides,
    };
    return pool.query('insert into plans (name, user_limit, grace_days, price_halalas, payment_period, discount_percent) values ($1, $2, $3, $4, $5, $6)', Object.values(plan));
  };

  it.each([
    ['a discount over 100', { discount_percent: 101 }, /plans_discount/],
    ['a negative price', { price_halalas: -1 }, /plans_price/],
    ['a zero user limit', { user_limit: 0 }, /plans_user_limit/],
    ['a grace period over 365', { grace_days: 366 }, /plans_grace_days/],
    ['an untrimmed name', { name: ' Basic ' }, /plans_name_length/],
    ['an unknown payment period', { payment_period: 'weekly' }, /invalid input value for enum payment_periods/],
  ])('rejects a plan with %s at the database level too', async (_label, overrides, pattern) => {
    expect(await rejectionText(insertPlan(overrides))).toMatch(pattern);
  });

  it('treats plan names case-insensitively in the unique index', async () => {
    await insertPlan({ name: 'Schema Unique' });
    expect(await rejectionText(insertPlan({ name: 'schema unique' }))).toMatch(/plans_name_lower_unique/);
  });
});
