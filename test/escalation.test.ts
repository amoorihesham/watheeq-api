import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/pool.js';
import { createLogger } from '../src/logging/logger.js';
import { isEscalationConfigured, readEscalation } from '../src/modules/escalation/index.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, rejectionText, seedRole, seedSubscribedTenant, seedUser, waitUntilBlockedOn } from './helpers/db.js';

const PASSWORD = 'correct horse battery staple';
const HUDA = 'huda@esc-alnoor.test';
const NORA = 'nora@esc-alnoor.test';
const VIEWER = 'viewer@esc-alnoor.test';
const RASHID_ADMIN = 'admin@esc-alrashid.test';

const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger('silent'));

let alNoor = '';
let rashidTenant = '';
let huda = '';
let hudaId = '';
let nora = '';
let viewer = '';
let rashid = '';
let rashidPosition = '';
let counter = 0;

let rashidUnitId = '';
let legal = '';
let intake = '';

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', accessCookie(access)),
  post: (path: string, body: object = {}) => request(app).post(path).set('Cookie', accessCookie(access)).send(body),
  put: (path: string, body: object) => request(app).put(path).set('Cookie', accessCookie(access)).send(body),
});

const org = (key: string) => ({ key, scope: 'organization' });
const nextName = (prefix: string) => `${prefix} ${++counter}`;

type Target = { position: string } | { builtin: string };

interface Config {
  r0: { enabled: boolean; days: number; recipients: Target[] };
  r1: { enabled: boolean; percent: number; recipients: Target[] };
  r2: { enabled: boolean; recipients: Target[] };
}

/** Al-Noor's escalation configuration (spec section 3). */
const alNoorConfig = (): Config => ({
  r0: { enabled: true, days: 2, recipients: [{ position: intake }] },
  r1: { enabled: true, percent: 75, recipients: [{ builtin: 'handler' }] },
  r2: {
    enabled: true,
    recipients: [{ builtin: 'handler' }, { builtin: 'handler_unit_managers' }, { builtin: 'handler_department_managers' }],
  },
});

const put = (body: object, token = huda) => as(token).put('/escalation', body);

/** Al-Noor's configuration as the audit log keeps it: recipients in a fixed order, not the order sent. */
const alNoorAudited = (): Config => {
  const config = alNoorConfig();
  config.r2.recipients = [{ builtin: 'handler' }, { builtin: 'handler_department_managers' }, { builtin: 'handler_unit_managers' }];
  return config;
};

/** The `escalation.updated` entries of a tenant, oldest first. */
const auditOf = (tenantId: string) => pool.query("select action, tenant_id, actor_type, actor_id, details from audit_log where resource_id = $1 and action = 'escalation.updated' order by id", [tenantId]).then((result) => result.rows);

async function insertUnit(tenantId: string, name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("insert into org_units (tenant_id, kind, parent_id, name) values ($1, 'department', null, $2) returning id", [tenantId, name]);
  return rows[0]?.id ?? '';
}

async function createPosition(name: string, unitId = legal, token = huda): Promise<string> {
  const res = await as(token).post('/positions', { unitId, name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function detailsOf(body: object, token = huda) {
  const res = await put(body, token);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_FAILED');
  return res.body.error.details;
}

/** Al-Noor's configuration with `over` replacing whole rules. */
const configWith = (over: Partial<Config>) => ({ ...alNoorConfig(), ...over });

/**
 * Runs `during` inside a transaction that holds `lockSql`, then commits. The lock is released even when
 * `during` fails, so a failing race test cannot hang the ones after it.
 */
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

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, 'esc-al-noor', [{ email: 'sara@esc-alnoor.test', userName: 'Sara', passwordHash }]);
  alNoor = tenant.id;
  const headOfLegal = await seedRole(pool, alNoor, {
    name: 'Head of Legal',
    permissions: ['position.view', 'position.manage', 'escalation.view', 'escalation.manage'].map(org),
  });
  const viewerRole = await seedRole(pool, alNoor, {
    name: 'Escalation Viewer',
    permissions: [org('escalation.view')],
  });

  legal = await insertUnit(alNoor, 'Legal Affairs');
  const addMember = async (userName: string, email: string, roleId: string) => {
    const id = await seedUser(pool, { email, userName, passwordHash });
    await pool.query('insert into tenant_members (tenant_id, user_id, role_id, unit_id) values ($1, $2, $3, $4)', [alNoor, id, roleId, legal]);
    return id;
  };
  hudaId = await addMember('Huda', HUDA, headOfLegal);
  await addMember('Nora', NORA, tenant.memberRoleId);
  await addMember('Viewer', VIEWER, viewerRole);

  const rashidSeed = await seedSubscribedTenant(pool, 'esc-al-rashid', [{ email: RASHID_ADMIN, passwordHash }]);
  rashidTenant = rashidSeed.id;
  rashidUnitId = await insertUnit(rashidTenant, 'Legal Affairs');

  huda = (await login(app, HUDA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
  intake = await createPosition('Legal Intake');
  rashidPosition = await createPosition('Their Post', rashidUnitId, rashid);
});

afterAll(async () => {
  await pool.end();
});

describe('not configured (R5.14)', () => {
  it('answers {configured: false} until a tenant saves, and isEscalationConfigured agrees', async () => {
    expect(await isEscalationConfigured(db, alNoor)).toBe(false);
    expect(await readEscalation(db, alNoor)).toBeNull();
    const res = await as(huda).get('/escalation');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ data: { configured: false, settings: null } });
  });
});

describe("saving Al-Noor's configuration (R5.13)", () => {
  it('saves R0 to Legal Intake, R1 to the Handler, and R2 to the three handler-side positions', async () => {
    const res = await put(alNoorConfig());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const handler = { position: null, name: null, builtin: 'handler' };
    expect(res.body).toEqual({
      data: {
        configured: true,
        settings: {
          r0: {
            enabled: true,
            days: 2,
            recipients: [{ position: intake, name: 'Legal Intake', builtin: null }],
          },
          r1: { enabled: true, percent: 75, recipients: [handler] },
          r2: {
            enabled: true,
            recipients: [handler, { ...handler, builtin: 'handler_unit_managers' }, { ...handler, builtin: 'handler_department_managers' }],
          },
        },
      },
    });
    expect((await as(huda).get('/escalation')).body).toEqual(res.body);
  });

  it('flips isEscalationConfigured and exposes the settings to Phase 7', async () => {
    expect(await isEscalationConfigured(db, alNoor)).toBe(true);
    expect(await readEscalation(db, alNoor)).toEqual({
      r0: { enabled: true, days: 2, recipients: [{ position: intake, name: 'Legal Intake' }] },
      r1: { enabled: true, percent: 75, recipients: [{ builtin: 'handler' }] },
      r2: {
        enabled: true,
        recipients: [{ builtin: 'handler' }, { builtin: 'handler_unit_managers' }, { builtin: 'handler_department_managers' }],
      },
    });
  });

  it('audits the first save with before null (R5.18)', async () => {
    expect(await auditOf(alNoor)).toEqual([
      {
        action: 'escalation.updated',
        tenant_id: alNoor,
        actor_type: 'user',
        actor_id: hudaId,
        details: { before: null, after: alNoorAudited() },
      },
    ]);
  });

  it('audits a later change with the whole before and after', async () => {
    const changed = configWith({
      r1: { enabled: true, percent: 50, recipients: [{ builtin: 'handler' }] },
    });
    expect((await put(changed)).status).toBe(200);
    const entries = await auditOf(alNoor);
    expect(entries).toHaveLength(2);
    expect(entries[1].details).toEqual({
      before: alNoorAudited(),
      after: { ...alNoorAudited(), r1: changed.r1 },
    });
    expect((await put(alNoorConfig())).status).toBe(200);
    expect(await auditOf(alNoor)).toHaveLength(3);
  });

  it('returns 200 with no audit entry when nothing changes, however the recipients are ordered or cased', async () => {
    const before = await auditOf(alNoor);
    const reordered = configWith({
      r2: {
        enabled: true,
        recipients: [{ builtin: 'handler_department_managers' }, { builtin: 'handler' }, { builtin: 'handler_unit_managers' }],
      },
      r0: { enabled: true, days: 2, recipients: [{ position: intake.toUpperCase() }] },
    });
    const res = await put(reordered);
    expect(res.status).toBe(200);
    expect(res.body).toEqual((await as(huda).get('/escalation')).body);
    expect(await auditOf(alNoor)).toHaveLength(before.length);
  });

  it('sends the same target to different rules without complaint', async () => {
    const both = configWith({
      r1: {
        enabled: true,
        percent: 75,
        recipients: [{ builtin: 'handler' }, { position: intake }],
      },
    });
    expect((await put(both)).status).toBe(200);
    expect((await put(alNoorConfig())).status).toBe(200);
  });

  it('accepts the requester side for R0', async () => {
    const config = configWith({
      r0: {
        enabled: true,
        days: 30,
        recipients: [{ builtin: 'requester' }, { builtin: 'requester_unit_managers' }, { builtin: 'requester_department_managers' }],
      },
      r1: { enabled: false, percent: 99, recipients: [{ builtin: 'handler' }] },
    });
    const res = await put(config);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.r0.days).toBe(30);
    expect(res.body.data.settings.r1.percent).toBe(99);
    expect((await put(alNoorConfig())).status).toBe(200);
  });
});

describe('validation (R5.13)', () => {
  it('keeps the stored configuration when a save is refused', async () => {
    const before = (await as(huda).get('/escalation')).body;
    await detailsOf(configWith({ r1: { enabled: true, percent: 75, recipients: [] } }));
    expect((await as(huda).get('/escalation')).body).toEqual(before);
  });

  it('requires thresholds even for a rule that is off', async () => {
    const body = alNoorConfig() as unknown as {
      r0: Record<string, unknown>;
      r1: Record<string, unknown>;
    };
    body.r0 = { enabled: false, recipients: [] };
    body.r1 = { enabled: false, recipients: [] };
    expect(await detailsOf(body)).toEqual([
      { path: 'r0.days', code: 'invalid_type' },
      { path: 'r1.percent', code: 'invalid_type' },
    ]);
  });

  it('limits R0 to 1-30 working days and R1 to 1-99 percent, whole numbers only', async () => {
    const r0 = (days: number) => configWith({ r0: { ...alNoorConfig().r0, days } });
    const r1 = (percent: number) => configWith({ r1: { ...alNoorConfig().r1, percent } });
    expect(await detailsOf(r0(0))).toEqual([{ path: 'r0.days', code: 'too_small' }]);
    expect(await detailsOf(r0(31))).toEqual([{ path: 'r0.days', code: 'too_big' }]);
    expect(await detailsOf(r0(1.5))).toEqual([{ path: 'r0.days', code: 'invalid_type' }]);
    expect(await detailsOf(r1(0))).toEqual([{ path: 'r1.percent', code: 'too_small' }]);
    expect(await detailsOf(r1(100))).toEqual([{ path: 'r1.percent', code: 'too_big' }]);
    expect((await put(r0(1))).status).toBe(200);
    expect((await put(r0(30))).status).toBe(200);
    expect((await put(r1(1))).status).toBe(200);
    expect((await put(r1(99))).status).toBe(200);
    expect((await put(alNoorConfig())).status).toBe(200);
  });

  it('refuses a rule that is on with no recipient', async () => {
    expect(await detailsOf(configWith({ r1: { enabled: true, percent: 75, recipients: [] } }))).toEqual([{ path: 'r1.recipients', code: 'no_recipients' }]);
    expect(await detailsOf(configWith({ r2: { enabled: true, recipients: [] } }))).toEqual([{ path: 'r2.recipients', code: 'no_recipients' }]);
    expect(await detailsOf(configWith({ r0: { enabled: true, days: 2, recipients: [] } }))).toEqual([{ path: 'r0.recipients', code: 'no_recipients' }]);
  });

  it('refuses the handler-side built-ins for R0 and names each', async () => {
    const details = await detailsOf(
      configWith({
        r0: {
          enabled: true,
          days: 2,
          recipients: [{ builtin: 'handler' }, { position: intake }, { builtin: 'handler_unit_managers' }, { builtin: 'handler_department_managers' }],
        },
      }),
    );
    expect(details).toEqual([
      { path: 'r0.recipients.0', code: 'not_for_rule' },
      { path: 'r0.recipients.2', code: 'not_for_rule' },
      { path: 'r0.recipients.3', code: 'not_for_rule' },
    ]);
  });

  it('refuses the handler-side built-ins for R0 even while R0 is off', async () => {
    expect(await detailsOf(configWith({ r0: { enabled: false, days: 2, recipients: [{ builtin: 'handler' }] } }))).toEqual([{ path: 'r0.recipients.0', code: 'not_for_rule' }]);
  });

  it('refuses a recipient listed twice in one rule', async () => {
    expect(
      await detailsOf(
        configWith({
          r2: {
            enabled: true,
            recipients: [{ builtin: 'handler' }, { builtin: 'requester' }, { builtin: 'handler' }],
          },
        }),
      ),
    ).toEqual([{ path: 'r2.recipients.2', code: 'duplicate_recipient' }]);
    expect(
      await detailsOf(
        configWith({
          r0: {
            enabled: true,
            days: 2,
            recipients: [{ position: intake }, { position: intake.toUpperCase() }],
          },
        }),
      ),
    ).toEqual([{ path: 'r0.recipients.1', code: 'duplicate_recipient' }]);
  });

  it("refuses unknown positions, including another tenant's, and retired ones", async () => {
    const retired = await createPosition(nextName('Old Post'));
    expect((await as(huda).post(`/positions/${retired}/retire`)).status).toBe(200);
    const details = await detailsOf(
      configWith({
        r0: {
          enabled: true,
          days: 2,
          recipients: [{ position: intake }, { position: rashidPosition }, { position: '11111111-1111-4111-8111-111111111111' }],
        },
        r1: { enabled: true, percent: 75, recipients: [{ position: retired }] },
      }),
    );
    expect(details).toEqual([
      { path: 'r0.recipients.1.position', code: 'unknown_position' },
      { path: 'r0.recipients.2.position', code: 'unknown_position' },
      { path: 'r1.recipients.0.position', code: 'position_retired' },
    ]);
  });

  it('refuses a retired position even for a rule that is off', async () => {
    const retired = await createPosition(nextName('Older Post'));
    expect((await as(huda).post(`/positions/${retired}/retire`)).status).toBe(200);
    expect(await detailsOf(configWith({ r1: { enabled: false, percent: 75, recipients: [{ position: retired }] } }))).toEqual([{ path: 'r1.recipients.0.position', code: 'position_retired' }]);
  });

  it('rejects unknown fields, missing rules, and malformed targets', async () => {
    expect(await detailsOf({ ...alNoorConfig(), r3: {} })).toEqual([{ path: 'r3', code: 'unknown_field' }]);
    const { r2: _omitted, ...withoutR2 } = alNoorConfig();
    expect(await detailsOf(withoutR2)).toEqual([{ path: 'r2', code: 'invalid_type' }]);
    expect(
      await detailsOf(
        configWith({
          r1: { enabled: true, percent: 75, recipients: [{ builtin: 'nobody' }] },
        }),
      ),
    ).toHaveLength(1);
    expect(
      await detailsOf(
        configWith({
          r1: {
            enabled: true,
            percent: 75,
            recipients: [{ builtin: 'handler', extra: true } as unknown as Target],
          },
        }),
      ),
    ).toHaveLength(1);
    expect(
      await detailsOf(
        configWith({
          r1: {
            enabled: true,
            percent: 75,
            recipients: Array.from({ length: 21 }, (_, i) => ({
              position: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            })),
          },
        }),
      ),
    ).toEqual([{ path: 'r1.recipients', code: 'too_big' }]);
  });
});

describe('a rule that is off keeps its values and recipients (R5.13)', () => {
  it('shows the stored threshold and recipients and still audits the change', async () => {
    const off = configWith({
      r1: {
        enabled: false,
        percent: 60,
        recipients: [{ builtin: 'handler' }, { position: intake }],
      },
    });
    const res = await put(off);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.r1).toEqual({
      enabled: false,
      percent: 60,
      recipients: [
        { position: null, name: null, builtin: 'handler' },
        { position: intake, name: 'Legal Intake', builtin: null },
      ],
    });
    expect((await as(huda).get('/escalation')).body.data.settings.r1).toEqual(res.body.data.settings.r1);
  });

  it('accepts a rule that is off with no recipients, and turns back on with its threshold intact', async () => {
    const off = configWith({ r2: { enabled: false, recipients: [] } });
    const res = await put(off);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.r2).toEqual({ enabled: false, recipients: [] });
    const on = await put(alNoorConfig());
    expect(on.status).toBe(200);
    expect(on.body.data.settings.r1).toEqual({
      enabled: true,
      percent: 75,
      recipients: [{ position: null, name: null, builtin: 'handler' }],
    });
  });
});

describe('position in use (R5.16)', () => {
  it('refuses retiring the position Al-Noor names for R0', async () => {
    const res = await as(huda).post(`/positions/${intake}/retire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSITION_IN_USE');
    expect((await as(huda).get(`/positions/${intake}`)).body.data.retired).toBe(false);
  });

  it('refuses retiring a position named only by a rule that is off, until it is taken out', async () => {
    const spare = await createPosition(nextName('Spare Post'));
    const parked = configWith({
      r1: { enabled: false, percent: 75, recipients: [{ position: spare }] },
    });
    expect((await put(parked)).status).toBe(200);

    const refused = await as(huda).post(`/positions/${spare}/retire`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('POSITION_IN_USE');

    expect((await put(alNoorConfig())).status).toBe(200);
    expect((await as(huda).post(`/positions/${spare}/retire`)).status).toBe(200);
    expect(await detailsOf(parked)).toEqual([{ path: 'r1.recipients.0.position', code: 'position_retired' }]);
  });

  it('does not count a recipient of another tenant', async () => {
    const mine = await createPosition(nextName('Mine Only'));
    const theirs = await createPosition(nextName('Theirs Only'), rashidUnitId, rashid);
    const config = {
      r0: { enabled: true, days: 3, recipients: [{ position: theirs }] },
      r1: { enabled: true, percent: 50, recipients: [{ builtin: 'handler' }] },
      r2: { enabled: false, recipients: [] },
    };
    expect((await put(config, rashid)).status).toBe(200);
    expect((await as(huda).post(`/positions/${mine}/retire`)).status).toBe(200);
    expect((await as(rashid).post(`/positions/${theirs}/retire`)).status).toBe(409);
    await pool.query('delete from escalation_recipients where tenant_id = $1', [rashidTenant]);
    await pool.query('delete from escalation_settings where tenant_id = $1', [rashidTenant]);
  });
});

describe('races with retiring a position (R5.16)', () => {
  it('refuses a save naming a position whose retire is in flight', async () => {
    const position = await createPosition(nextName('Race Save Pre'));
    const config = configWith({
      r1: { enabled: true, percent: 75, recipients: [{ position }] },
    });
    const before = (await as(huda).get('/escalation')).body;

    let saving: Promise<request.Response> = Promise.reject(new Error('not started'));
    saving.catch(() => undefined);
    await whileHolding('select id from positions where id = $1 for update', [position], async (client) => {
      saving = put(config).then((res) => res);
      await waitUntilBlockedOn(pool, 'positions');
      await client.query('update positions set retired_at = now() where id = $1', [position]);
    });
    const res = await saving;

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'r1.recipients.0.position', code: 'position_retired' }]);
    expect((await as(huda).get('/escalation')).body).toEqual(before);
  });

  it('refuses retiring a position whose escalation save is in flight', async () => {
    const position = await createPosition(nextName('Race Retire Post'));

    let retiring: Promise<request.Response> = Promise.reject(new Error('not started'));
    retiring.catch(() => undefined);
    // A save in flight: it holds the share lock and has written the new recipient.
    await whileHolding('select id from positions where id = $1 for share', [position], async (client) => {
      retiring = as(huda)
        .post(`/positions/${position}/retire`)
        .then((res) => res);
      await waitUntilBlockedOn(pool, 'positions');
      await client.query("insert into escalation_recipients (tenant_id, rule, target_position_id) values ($1, 'r2', $2)", [alNoor, position]);
    });
    const res = await retiring;

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSITION_IN_USE');
    expect((await as(huda).get(`/positions/${position}`)).body.data.retired).toBe(false);
    await pool.query('delete from escalation_recipients where target_position_id = $1', [position]);
  });
});

describe('concurrent saves', () => {
  it("waits for the tenant's lock before saving", async () => {
    const changed = configWith({ r2: { enabled: false, recipients: [] } });
    const entries = (await auditOf(alNoor)).length;

    let saving: Promise<request.Response> = Promise.reject(new Error('not started'));
    saving.catch(() => undefined);
    await whileHolding('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`escalation:${alNoor}`], async () => {
      saving = put(changed).then((res) => res);
      await waitUntilBlockedOn(pool, 'pg_advisory_xact_lock');
      expect(await auditOf(alNoor)).toHaveLength(entries);
    });
    expect((await saving).status).toBe(200);
    expect(await auditOf(alNoor)).toHaveLength(entries + 1);
    expect((await put(alNoorConfig())).status).toBe(200);
  });

  it("serializes two first saves: one sees before null, the other sees the first one's result", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, 'esc-concurrent', [{ email: 'admin@esc-concurrent.test', passwordHash }]);
    const admin = (await login(app, 'admin@esc-concurrent.test', PASSWORD)).access;
    const first = {
      r0: { enabled: false, days: 1, recipients: [] },
      r1: { enabled: true, percent: 10, recipients: [{ builtin: 'handler' }] },
      r2: { enabled: false, recipients: [] },
    };
    const second = {
      ...first,
      r1: { enabled: true, percent: 20, recipients: [{ builtin: 'requester' }] },
    };

    const results = await Promise.all([put(first, admin), put(second, admin)]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const entries = await auditOf(tenant.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].details.before).toBeNull();
    expect(entries[1].details.before).toEqual(entries[0].details.after);
    const stored = (await as(admin).get('/escalation')).body.data.settings;
    expect(stored.r1.percent).toBe(entries[1].details.after.r1.percent);
    const { rows } = await pool.query('select count(*)::int as n from escalation_recipients where tenant_id = $1', [tenant.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('storage rules', () => {
  it('keeps a recipient to one target kind and one row per rule and target', async () => {
    const both = await rejectionText(pool.query("insert into escalation_recipients (tenant_id, rule, target_position_id, target_builtin) values ($1, 'r1', $2, 'handler')", [alNoor, intake]));
    expect(both).toMatch(/escalation_recipients_one_target/);
    const neither = await rejectionText(pool.query("insert into escalation_recipients (tenant_id, rule) values ($1, 'r1')", [alNoor]));
    expect(neither).toMatch(/escalation_recipients_one_target/);
    const builtinTwice = await rejectionText(pool.query("insert into escalation_recipients (tenant_id, rule, target_builtin) values ($1, 'r1', 'handler')", [alNoor]));
    expect(builtinTwice).toMatch(/escalation_recipients_builtin_unique/);
    const positionTwice = await rejectionText(pool.query("insert into escalation_recipients (tenant_id, rule, target_position_id) values ($1, 'r0', $2)", [alNoor, intake]));
    expect(positionTwice).toMatch(/escalation_recipients_position_unique/);
  });

  it('keeps a recipient position within its own tenant', async () => {
    const err = await rejectionText(pool.query("insert into escalation_recipients (tenant_id, rule, target_position_id) values ($1, 'r2', $2)", [alNoor, rashidPosition]));
    expect(err).toMatch(/escalation_recipients_position_fk/);
  });

  it('keeps thresholds in range', async () => {
    const days = await rejectionText(pool.query('update escalation_settings set r0_days = 31 where tenant_id = $1', [alNoor]));
    expect(days).toMatch(/escalation_settings_r0_days_range/);
    const percent = await rejectionText(pool.query('update escalation_settings set r1_percent = 100 where tenant_id = $1', [alNoor]));
    expect(percent).toMatch(/escalation_settings_r1_percent_range/);
  });
});

describe('authorization (R5.17)', () => {
  it('refuses a member with no escalation permissions', async () => {
    for (const res of [await as(nora).get('/escalation'), await put(alNoorConfig(), nora)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('lets escalation.view read but not change', async () => {
    const read = await as(viewer).get('/escalation');
    expect(read.status).toBe(200);
    expect(read.body.data.configured).toBe(true);
    expect((await put(alNoorConfig(), viewer)).status).toBe(403);
  });

  it('lets the Tenant Admin manage without any role change', async () => {
    const sara = (await login(app, 'sara@esc-alnoor.test', PASSWORD)).access;
    expect((await put(alNoorConfig(), sara)).status).toBe(200);
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get('/escalation')).status).toBe(401);
    expect((await request(app).put('/escalation').send(alNoorConfig())).status).toBe(401);
  });
});

describe('Read-only subscriptions (R5.18)', () => {
  it('refuses a save and still shows the settings', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, 'esc-read-only', [{ email: 'admin@esc-read-only.test', passwordHash }]);
    const admin = (await login(app, 'admin@esc-read-only.test', PASSWORD)).access;
    const config = {
      r0: { enabled: false, days: 2, recipients: [] },
      r1: { enabled: true, percent: 75, recipients: [{ builtin: 'handler' }] },
      r2: { enabled: false, recipients: [] },
    };
    expect((await put(config, admin)).status).toBe(200);
    await pool.query('update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1', [tenant.id]);
    const res = await put({ ...config, r2: { enabled: true, recipients: [{ builtin: 'handler' }] } }, admin);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    const read = await as(admin).get('/escalation');
    expect(read.status).toBe(200);
    expect(read.body.data.settings.r2.enabled).toBe(false);
  });
});

describe('tenant isolation (R5.19)', () => {
  it('shows Al-Rashid its own state, however Al-Noor is configured', async () => {
    expect((await as(huda).get('/escalation')).body.data.configured).toBe(true);
    expect((await as(rashid).get('/escalation')).body).toEqual({
      data: { configured: false, settings: null },
    });
    expect(await isEscalationConfigured(db, rashidTenant)).toBe(false);
  });

  it("keeps each tenant's save to itself", async () => {
    const mine = (await as(huda).get('/escalation')).body;
    const config = {
      r0: { enabled: false, days: 5, recipients: [] },
      r1: { enabled: true, percent: 40, recipients: [{ builtin: 'requester' }] },
      r2: { enabled: false, recipients: [] },
    };
    const rashidEntries = (await auditOf(rashidTenant)).length;
    expect((await put(config, rashid)).status).toBe(200);
    expect((await as(huda).get('/escalation')).body).toEqual(mine);
    expect((await as(rashid).get('/escalation')).body.data.settings.r1.percent).toBe(40);
    expect(await auditOf(rashidTenant)).toHaveLength(rashidEntries + 1);
    await pool.query('delete from escalation_recipients where tenant_id = $1', [rashidTenant]);
    await pool.query('delete from escalation_settings where tenant_id = $1', [rashidTenant]);
  });

  it('answers an Al-Noor position named by Al-Rashid as unknown', async () => {
    const config = {
      r0: { enabled: true, days: 2, recipients: [{ position: intake }] },
      r1: { enabled: false, percent: 50, recipients: [] },
      r2: { enabled: false, recipients: [] },
    };
    expect(await detailsOf(config, rashid)).toEqual([{ path: 'r0.recipients.0.position', code: 'unknown_position' }]);
  });
});
