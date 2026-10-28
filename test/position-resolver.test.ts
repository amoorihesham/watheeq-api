import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/pool.js';
import { type AssigneeContextType, type AssigneeTargetType, nextLevel, type ResolveOptionsType, resolveAssignees } from '../src/modules/positions/index.js';
import { connectToTestDb, seedTenant, seedUser } from './helpers/db.js';

const pool = connectToTestDb();
const db = createDb(pool);

let alNoor = '';
let memberRoleId = '';
let counter = 0;

// Al-Noor as in the Phase 5 spec, section 3.
let legal = '';
let contracts = '';
let litigation = '';
let finance = '';
let procurement = '';
const u = { huda: '', ahmed: '', faisal: '', nora: '', khalid: '', reem: '', majed: '', lina: '' };
let contractsSupervisor = '';
let procurementReviewer = '';
let legalIntake = '';
let rashidPosition = '';

async function insertUnit(name: string, parentId: string | null = null): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id', [alNoor, parentId ? 'section' : 'department', parentId, name]);
  return rows[0]?.id ?? '';
}

async function addMember(userName: string, unitId: string | null, options: { manager?: boolean; active?: boolean } = {}): Promise<string> {
  const id = await seedUser(pool, {
    email: `${userName.toLowerCase()}.${++counter}@res-alnoor.test`,
    userName,
    isActive: options.active ?? true,
  });
  await pool.query('insert into tenant_members (tenant_id, user_id, role_id, unit_id, is_manager) values ($1, $2, $3, $4, $5)', [alNoor, id, memberRoleId, unitId, options.manager ?? false]);
  return id;
}

async function insertPosition(tenantId: string, name: string, unitId: string, holders: string[] = []): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('insert into positions (tenant_id, unit_id, name) values ($1, $2, $3) returning id', [tenantId, unitId, name]);
  const id = rows[0]?.id ?? '';
  for (const holder of holders) {
    await pool.query('update tenant_members set position_id = $2 where user_id = $1', [holder, id]);
  }
  return id;
}

const position = (id: string): AssigneeTargetType => ({ position: id });
const builtin = (name: AssigneeBuiltinName): AssigneeTargetType => ({ builtin: name });
type AssigneeBuiltinName = Extract<AssigneeTargetType, { builtin: string }>['builtin'];

const keep: ResolveOptionsType = { excludeParties: false };
const exclude: ResolveOptionsType = { excludeParties: true };
const sorted = (ids: string[]) => [...ids].sort();

const resolve = (target: AssigneeTargetType, context: AssigneeContextType, options: ResolveOptionsType = keep) => resolveAssignees(db, alNoor, target, context, options);

beforeAll(async () => {
  const tenant = await seedTenant(pool, 'res-al-noor', [{ email: 'sara@res-alnoor.test' }]);
  alNoor = tenant.id;
  memberRoleId = tenant.memberRoleId;
  legal = await insertUnit('Legal Affairs');
  contracts = await insertUnit('Contracts', legal);
  litigation = await insertUnit('Litigation', legal);
  finance = await insertUnit('Finance');
  procurement = await insertUnit('Procurement', finance);
  u.huda = await addMember('Huda', legal, { manager: true });
  u.ahmed = await addMember('Ahmed', legal, { manager: true });
  u.faisal = await addMember('Faisal', contracts, { manager: true });
  u.nora = await addMember('Nora', contracts);
  u.khalid = await addMember('Khalid', procurement);
  u.reem = await addMember('Reem', procurement, { manager: true });
  u.majed = await addMember('Majed', finance, { manager: true });
  u.lina = await addMember('Lina', null);
  contractsSupervisor = await insertPosition(alNoor, 'Contracts Supervisor', contracts, [u.faisal]);
  procurementReviewer = await insertPosition(alNoor, 'Procurement Reviewer', procurement, [u.khalid]);
  legalIntake = await insertPosition(alNoor, 'Legal Intake', legal, [u.ahmed]);

  const rashid = await seedTenant(pool, 'res-al-rashid', [{ email: 'admin@res-alrashid.test' }]);
  const rashidUnit = (await pool.query<{ id: string }>("insert into org_units (tenant_id, kind, name) values ($1, 'department', 'Legal') returning id", [rashid.id])).rows[0]?.id;
  rashidPosition = await insertPosition(rashid.id, 'Rashid Supervisor', rashidUnit ?? '');
  await pool.query('update tenant_members set unit_id = $2, position_id = $3 where user_id = $1', [rashid.userIds[0], rashidUnit, rashidPosition]);
});

afterAll(async () => {
  await pool.end();
});

// Khalid (Procurement) submits; Faisal (Contracts) is the handler.
const request42: AssigneeContextType = { handlerId: '', requesterId: '' };
beforeAll(() => {
  request42.handlerId = u.faisal;
  request42.requesterId = u.khalid;
});

describe('tenant positions (R5.5)', () => {
  it('resolves a position to its holders', async () => {
    expect(await resolve(position(contractsSupervisor), request42)).toEqual({
      level: { kind: 'position', positionId: contractsSupervisor },
      userIds: [u.faisal],
    });
  });

  it('resolves a vacant position to nobody, keeping the level to climb from', async () => {
    const vacant = await insertPosition(alNoor, 'Vacant Desk', litigation);
    expect(await resolve(position(vacant), request42)).toEqual({
      level: { kind: 'position', positionId: vacant },
      userIds: [],
    });
  });

  it('resolves several holders, ordered by id', async () => {
    const pair = await insertPosition(alNoor, 'Pair Desk', litigation, [await addMember('Pair One', litigation), await addMember('Pair Two', litigation)]);
    const { userIds } = await resolve(position(pair), request42);
    expect(userIds).toHaveLength(2);
    expect(userIds).toEqual(sorted(userIds));
  });

  it('never resolves a deactivated holder', async () => {
    const leaver = await addMember('Inactive Holder', litigation, { active: false });
    const desk = await insertPosition(alNoor, 'Inactive Desk', litigation);
    await pool.query('update tenant_members set position_id = $2 where user_id = $1', [leaver, desk]);
    expect((await resolve(position(desk), request42)).userIds).toEqual([]);
  });

  it("never resolves another tenant's position", async () => {
    expect((await resolve(position(rashidPosition), request42)).userIds).toEqual([]);
  });

  it('resolves a retired position to nobody', async () => {
    const desk = await insertPosition(alNoor, 'Retired Desk', litigation);
    await pool.query('update positions set retired_at = now() where id = $1', [desk]);
    expect((await resolve(position(desk), request42)).userIds).toEqual([]);
  });
});

describe('built-in positions (R5.4)', () => {
  it('resolves each built-in for a request from Khalid handled by Faisal', async () => {
    const ids = async (name: AssigneeBuiltinName) => sorted((await resolve(builtin(name), request42)).userIds);
    expect(await ids('handler')).toEqual([u.faisal]);
    expect(await ids('requester')).toEqual([u.khalid]);
    expect(await ids('requester_unit_managers')).toEqual([u.reem]);
    expect(await ids('requester_department_managers')).toEqual([u.majed]);
    // Faisal manages Contracts himself, so he is left out of his own managers (R5.6).
    expect(await ids('handler_unit_managers')).toEqual([]);
    expect(await ids('handler_department_managers')).toEqual(sorted([u.huda, u.ahmed]));
  });

  it("takes a department's own managers for a requester in a department", async () => {
    const context = { handlerId: u.faisal, requesterId: u.nora };
    expect(sorted((await resolve(builtin('requester_unit_managers'), context)).userIds)).toEqual([u.faisal]);
    expect(sorted((await resolve(builtin('requester_department_managers'), context)).userIds)).toEqual(sorted([u.huda, u.ahmed]));
    const inDepartment = { handlerId: null, requesterId: u.majed };
    const unitLevel = await resolve(builtin('requester_unit_managers'), inDepartment);
    expect(unitLevel.level).toEqual({ kind: 'managers', unitId: finance, anchor: 'requester' });
    expect(unitLevel.userIds).toEqual([]);
  });

  it('gives a person with no unit no unit managers and no department managers (D19)', async () => {
    const context = { handlerId: u.lina, requesterId: u.lina };
    for (const name of ['requester_unit_managers', 'requester_department_managers', 'handler_unit_managers', 'handler_department_managers'] as const) {
      const resolved = await resolve(builtin(name), context);
      expect(resolved.userIds).toEqual([]);
      expect(await nextLevel(db, alNoor, resolved.level, context, keep)).toBeNull();
    }
    expect((await resolve(builtin('requester'), context)).userIds).toEqual([u.lina]);
  });

  it('resolves the handler side to nobody before a handler exists', async () => {
    const beforeAcceptance = { handlerId: null, requesterId: u.khalid };
    for (const name of ['handler', 'handler_unit_managers', 'handler_department_managers'] as const) {
      expect((await resolve(builtin(name), beforeAcceptance)).userIds).toEqual([]);
    }
    expect((await resolve(builtin('requester_department_managers'), beforeAcceptance)).userIds).toEqual([u.majed]);
  });

  it('never resolves a deactivated person or manager', async () => {
    const dormant = await insertUnit('Dormant Department');
    const dormantSection = await insertUnit('Dormant Section', dormant);
    const requester = await addMember('Dormant Requester', dormantSection);
    await addMember('Dormant Manager', dormantSection, { manager: true, active: false });
    const head = await addMember('Dormant Head', dormant, { manager: true });
    const context = { handlerId: null, requesterId: requester };
    const unit = await resolve(builtin('requester_unit_managers'), context);
    expect(unit.userIds).toEqual([]);
    expect((await nextLevel(db, alNoor, unit.level, context, keep))?.userIds).toEqual([head]);
    await pool.query('update users set is_active = false where id = $1', [requester]);
    expect((await resolve(builtin('requester'), context)).userIds).toEqual([]);
  });
});

describe('exclusions (R5.6)', () => {
  it('leaves the anchor out of its own managers, even when the parties are not excluded', async () => {
    const context = { handlerId: u.huda, requesterId: u.khalid };
    expect((await resolve(builtin('handler_unit_managers'), context, keep)).userIds).toEqual([u.ahmed]);
    expect((await resolve(builtin('handler_department_managers'), context, keep)).userIds).toEqual([u.ahmed]);
  });

  it('excludes the handler and the requester from a stage that excludes the parties', async () => {
    // Khalid holds Procurement Reviewer and is the requester.
    expect((await resolve(position(procurementReviewer), request42, keep)).userIds).toEqual([u.khalid]);
    expect((await resolve(position(procurementReviewer), request42, exclude)).userIds).toEqual([]);
    // Faisal holds Contracts Supervisor and is the handler.
    expect((await resolve(position(contractsSupervisor), request42, keep)).userIds).toEqual([u.faisal]);
    expect((await resolve(position(contractsSupervisor), request42, exclude)).userIds).toEqual([]);
  });

  it('excludes the parties from built-in managers positions too', async () => {
    // Majed manages Finance and is the requester's department's manager; as the handler he is excluded.
    const context = { handlerId: u.majed, requesterId: u.khalid };
    expect((await resolve(builtin('requester_department_managers'), context, keep)).userIds).toEqual([u.majed]);
    expect((await resolve(builtin('requester_department_managers'), context, exclude)).userIds).toEqual([]);
  });
});

describe('climbing (R5.7, Q18)', () => {
  it('climbs from a position to the managers of its unit', async () => {
    const context = { handlerId: u.nora, requesterId: u.khalid };
    const start = await resolve(position(procurementReviewer), context, exclude);
    expect(start.userIds).toEqual([]);
    const next = await nextLevel(db, alNoor, start.level, context, exclude);
    expect(next).toEqual({
      level: { kind: 'managers', unitId: procurement },
      userIds: [u.reem],
    });
  });

  it('passes over a level left empty by vacancies or exclusions', async () => {
    // Contracts' only manager is the handler, so the climb reaches Legal Affairs.
    const start = await resolve(position(contractsSupervisor), request42, exclude);
    const next = await nextLevel(db, alNoor, start.level, request42, exclude);
    expect(next?.level).toEqual({ kind: 'managers', unitId: legal });
    expect(sorted(next?.userIds ?? [])).toEqual(sorted([u.huda, u.ahmed]));
  });

  it('passes over a section with no manager', async () => {
    const vacant = await insertPosition(alNoor, 'Litigation Clerk', litigation);
    const start = await resolve(position(vacant), request42, keep);
    expect(start.userIds).toEqual([]);
    const next = await nextLevel(db, alNoor, start.level, request42, keep);
    expect(next?.level).toEqual({ kind: 'managers', unitId: legal });
    expect(sorted(next?.userIds ?? [])).toEqual(sorted([u.huda, u.ahmed]));
  });

  it("ends after the department's managers (Q18)", async () => {
    const start = await resolve(position(legalIntake), request42, keep);
    const first = await nextLevel(db, alNoor, start.level, request42, keep);
    expect(first?.level).toEqual({ kind: 'managers', unitId: legal });
    expect(sorted(first?.userIds ?? [])).toEqual(sorted([u.huda, u.ahmed]));
    expect(await nextLevel(db, alNoor, first?.level ?? start.level, request42, keep)).toBeNull();
  });

  it('returns null when every level above is empty', async () => {
    const bare = await insertUnit('Bare Department');
    const bareSection = await insertUnit('Bare Section', bare);
    const desk = await insertPosition(alNoor, 'Bare Desk', bareSection);
    const start = await resolve(position(desk), request42, keep);
    expect(await nextLevel(db, alNoor, start.level, request42, keep)).toBeNull();
  });

  it("climbs from the handler to the managers of the handler's unit, without the handler", async () => {
    const start = await resolve(builtin('handler'), request42, keep);
    expect(start.level).toEqual({ kind: 'person', party: 'handler' });
    const next = await nextLevel(db, alNoor, start.level, request42, keep);
    expect(next?.level).toEqual({ kind: 'managers', unitId: legal, anchor: 'handler' });
    expect(sorted(next?.userIds ?? [])).toEqual(sorted([u.huda, u.ahmed]));
  });

  it('climbs from the handler through a unit whose only manager is a colleague', async () => {
    const context = { handlerId: u.nora, requesterId: u.khalid };
    const start = await resolve(builtin('handler'), context, keep);
    const next = await nextLevel(db, alNoor, start.level, context, keep);
    expect(next).toEqual({
      level: { kind: 'managers', unitId: contracts, anchor: 'handler' },
      userIds: [u.faisal],
    });
    const above = await nextLevel(db, alNoor, next?.level ?? start.level, context, keep);
    expect(above?.level).toEqual({ kind: 'managers', unitId: legal, anchor: 'handler' });
  });

  it('climbs from a built-in managers position to the department, keeping the anchor', async () => {
    const start = await resolve(builtin('requester_unit_managers'), request42, keep);
    expect(start.userIds).toEqual([u.reem]);
    const next = await nextLevel(db, alNoor, start.level, request42, keep);
    expect(next).toEqual({
      level: { kind: 'managers', unitId: finance, anchor: 'requester' },
      userIds: [u.majed],
    });
    expect(await nextLevel(db, alNoor, next?.level ?? start.level, request42, keep)).toBeNull();
  });

  it('climbs again from the level it returned', async () => {
    const context = { handlerId: u.faisal, requesterId: u.nora };
    const unit = await resolve(builtin('handler_unit_managers'), context, keep);
    expect(unit.userIds).toEqual([]);
    const department = await nextLevel(db, alNoor, unit.level, context, keep);
    expect(department?.level).toEqual({ kind: 'managers', unitId: legal, anchor: 'handler' });
    expect(await nextLevel(db, alNoor, department?.level ?? unit.level, context, keep)).toBeNull();
  });
});

describe('the worked example (Phase 5 spec, 4.3)', () => {
  it("resolves Khalid's request for Vendor contract v1, handled by Faisal", async () => {
    // 1. Business approval: Requester's department managers.
    expect((await resolve(builtin('requester_department_managers'), request42, keep)).userIds).toEqual([u.majed]);

    // 2. Drafting: Handler.
    expect((await resolve(builtin('handler'), request42, keep)).userIds).toEqual([u.faisal]);

    // 3. Procurement check: Khalid holds Procurement Reviewer but is the requester, so nobody; the stage skips.
    expect((await resolve(position(procurementReviewer), request42, exclude)).userIds).toEqual([]);

    // 4. Supervisor sign-off: Faisal holds Contracts Supervisor but is the handler; escalate reaches Legal Affairs.
    const signOff = await resolve(position(contractsSupervisor), request42, exclude);
    expect(signOff.userIds).toEqual([]);
    const escalated = await nextLevel(db, alNoor, signOff.level, request42, exclude);
    expect(escalated?.level).toEqual({ kind: 'managers', unitId: legal });
    expect(sorted(escalated?.userIds ?? [])).toEqual(sorted([u.huda, u.ahmed]));

    // Without "exclude the parties", Faisal would sign off his own work.
    expect((await resolve(position(contractsSupervisor), request42, keep)).userIds).toEqual([u.faisal]);
  });
});
