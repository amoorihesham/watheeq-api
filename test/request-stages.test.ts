import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/pool.js';
import { withTx } from '../src/db/tx.js';
import { createLogger } from '../src/logging/logger.js';
import { DEFAULT_WEEK } from '../src/modules/calendar/index.js';
import { closeRequest, visibleRequests } from '../src/modules/requests/index.js';
import { createRequestsRepository } from '../src/modules/requests/requests.repository.js';
import { type AlNoorType, asUser, type PersonType, seedAlNoor, vendorAnswers } from './helpers/al-noor.js';
import { testApp } from './helpers/app.js';
import { hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, rejectionText, seedRole, seedUser, waitUntilBlockedOn } from './helpers/db.js';

// Phase 6 spec, step 6.2: stage runs, the fallbacks, complete, return, narrow, escalate, refresh, reassign, and the
// closure record of a completed request. Al-Noor and request #42 are those of the spec's section 3.

const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger('silent'));

let alNoor: AlNoorType;
let counter = 0;
const offered: { id: string; isDefault: boolean }[] = [];

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const codeOf = (res: { body: { error: { code: string } } }) => res.body.error.code;
const detailsOf = (res: { body: { error: { details: unknown } } }) => res.body.error.details;

type StageRunType = {
  id: string;
  state: string;
  stage: { name: string; ordinal: number };
  narrowed: boolean;
  escalated: boolean;
  assignees: { id: string; name: string }[];
  comment: string | null;
};
type RequestBodyType = {
  id: string;
  state: string;
  stages: StageRunType[];
  activeStage: { name: string; waitingOn: { id: string; name: string }[] } | null;
  sla: { deadline: string; elapsedDays: number; met: boolean; breachDays: number } | null;
  allowedActions: string[];
};

const stage = (name: string, assignee: object, whenUnresolved: string, options: { narrow?: boolean; escalate?: boolean; exclude?: boolean } = {}) => ({
  name,
  assignee,
  whenUnresolved,
  handlerMayNarrow: options.narrow ?? false,
  handlerMayEscalate: options.escalate ?? false,
  excludeParties: options.exclude ?? false,
});

/** Creates a workflow and adds it to the service's allowed list. */
async function offer(name: string, stages: object[]): Promise<string> {
  const created = await as('sara').post('/workflows', { name: `${name} ${++counter}`, stages });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  offered.push({ id, isDefault: false });
  const res = await asUser(app, alNoor.tokens.sara).patch(`/services/${alNoor.serviceId}`, {
    workflows: [{ id: alNoor.workflows.vendor, isDefault: true }, { id: alNoor.workflows.complex, isDefault: false }, ...offered],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

async function submitAs(access: string): Promise<string> {
  const res = await asUser(app, access).post('/requests', {
    serviceId: alNoor.serviceId,
    priorityId: alNoor.priorities.high,
    title: 'Gulf Supplies contract',
    answers: vendorAnswers(alNoor),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}

async function acceptWith(id: string, workflowId: string, handler: PersonType = 'faisal'): Promise<RequestBodyType> {
  const res = await as('huda').post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids[handler],
    workflowId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

/** A request from Khalid, accepted into the given workflow. */
async function open(workflowId = alNoor.workflows.vendor, handler: PersonType = 'faisal') {
  const id = await submitAs(alNoor.tokens.khalid);
  return { id, request: await acceptWith(id, workflowId, handler) };
}

const detail = async (id: string, viewer: PersonType = 'huda'): Promise<RequestBodyType> => (await as(viewer).get(`/requests/${id}`)).body.data;

const live = (request: RequestBodyType) => request.stages.find((run) => run.state === 'active' || run.state === 'held');

const names = (request: RequestBodyType) => request.stages.map((run) => `${run.stage.name}:${run.state}`);

const act = (person: PersonType, id: string, runId: string, action: 'complete' | 'return' | 'narrow' | 'escalate' | 'refresh', body: object = {}) => as(person).post(`/requests/${id}/stages/${runId}/${action}`, body);

async function complete(person: PersonType, id: string, body: object = {}) {
  const run = live(await detail(id, person));
  expect(run, 'a live run').toBeDefined();
  const res = await act(person, id, run?.id ?? '', 'complete', body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as RequestBodyType;
}

const rowOf = (id: string) => pool.query('select * from requests where id = $1', [id]).then((result) => result.rows[0]);

const auditActions = (id: string) => pool.query('select action, details from audit_log where resource_id = $1 order by id', [id]).then((result) => result.rows);

let memberCounter = 0;
async function newMember(unitId: string | null, options: { manager?: boolean; handle?: boolean } = {}): Promise<{ id: string; access: string }> {
  const n = ++memberCounter;
  const email = `m${n}@stg-al-noor.test`;
  const password = 'correct horse battery staple';
  const id = await seedUser(pool, {
    email,
    userName: `Member ${n}`,
    passwordHash: await hashPassword(password),
  });
  const roleId = await seedRole(pool, alNoor.tenantId, {
    name: `Stage role ${n}`,
    permissions: [
      { key: 'request.submit', scope: 'own' },
      { key: 'request.view', scope: 'own' },
    ],
  });
  await pool.query('insert into tenant_members (tenant_id, user_id, role_id, unit_id, is_manager) values ($1, $2, $3, $4, $5)', [alNoor.tenantId, id, roleId, unitId, options.manager ?? false]);
  return { id, access: (await login(app, email, password)).access };
}

async function newUnit(name: string, parentId: string | null = null): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id', [alNoor.tenantId, parentId ? 'section' : 'department', parentId, name]);
  return rows[0]?.id ?? '';
}

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, 'stg-al-noor');
  // The calendar's own history reaches back, so requests accepted in the past have working time to measure.
  await pool.query("insert into working_hours (tenant_id, effective_from, week) values ($1, '2020-01-01', $2)", [alNoor.tenantId, JSON.stringify(DEFAULT_WEEK)]);
});

afterAll(async () => {
  await pool.end();
});

describe('the worked example on #42 (R6.10, R6.13-R6.16, R6.23)', () => {
  it('runs from acceptance to completion', async () => {
    const id = await submitAs(alNoor.tokens.khalid);
    const accepted = await acceptWith(id, alNoor.workflows.vendor);
    // Business approval waits on the manager of Khalid's department.
    expect(accepted.activeStage).toEqual({
      name: 'Business approval',
      waitingOn: [{ id: alNoor.ids.majed, name: 'Majed' }],
    });
    expect(names(accepted)).toEqual(['Business approval:active']);
    expect((await as('majed').get('/requests?view=waiting_on_me')).body.data.map((r: { id: string }) => r.id)).toContain(id);
    expect((await as('khalid').get('/requests?view=waiting_on_me')).body.data).toEqual([]);

    const afterApproval = await complete('majed', id, { comment: 'Within the Q4 budget' });
    expect(names(afterApproval)).toEqual(['Business approval:completed', 'Drafting:active']);
    expect(afterApproval.stages[0]?.comment).toBe('Within the Q4 budget');
    expect(afterApproval.activeStage?.waitingOn).toEqual([{ id: alNoor.ids.faisal, name: 'Faisal' }]);

    // Procurement check resolves to nobody (Khalid is a party) and is skipped; sign-off climbs to Legal Affairs.
    const afterDrafting = await complete('faisal', id);
    expect(names(afterDrafting)).toEqual(['Business approval:completed', 'Drafting:completed', 'Procurement check:skipped', 'Supervisor sign-off:active']);
    const signOff = live(afterDrafting);
    expect(signOff).toMatchObject({ escalated: true });
    expect(signOff?.assignees.map((a) => a.name)).toEqual(['Ahmed', 'Huda']);

    // The chain has ended at Legal Affairs' managers.
    const escalating = await act('faisal', id, signOff?.id ?? '', 'escalate', {
      reason: 'needs more',
    });
    expect(escalating.status).toBe(409);
    expect(codeOf(escalating)).toBe('NO_HIGHER_LEVEL');

    // Returning passes over the skipped stage: Drafting starts again for Faisal.
    const returned = await act('huda', id, signOff?.id ?? '', 'return', {
      reason: 'needs a change',
    });
    expect(returned.status).toBe(200);
    expect(names(returned.body.data)).toEqual(['Business approval:completed', 'Drafting:completed', 'Procurement check:skipped', 'Supervisor sign-off:returned', 'Drafting:active']);
    expect(returned.body.data.stages[3].comment).toBe('needs a change');

    await complete('faisal', id);
    const completed = await complete('huda', id);
    expect(completed.state).toBe('completed');
    expect(completed.activeStage).toBeNull();
    expect(completed.sla).toMatchObject({ met: true, breachDays: 0 });
    expect(await rowOf(id)).toMatchObject({ state: 'completed', closed_by: alNoor.ids.huda });

    const actions = (await auditActions(id)).map((entry) => entry.action);
    expect(actions).toEqual(['request.submitted', 'request.accepted', 'request.stage_completed', 'request.stage_completed', 'request.stage_returned', 'request.stage_completed', 'request.stage_completed', 'request.completed']);
    const accepting = (await auditActions(id)).find((e) => e.action === 'request.accepted');
    expect(accepting?.details.transitions).toEqual([expect.objectContaining({ state: 'active', assignees: [alNoor.ids.majed] })]);
  });
});

describe('starting and refreshing stages (R6.13, R6.18)', () => {
  it('holds a stage with no assignees, and a refresh finds the manager that was added (R6.18)', async () => {
    const ops = await newUnit('Operations');
    const requester = await newMember(ops);
    const workflowId = await offer('Ops approval', [stage('Ops approval', { builtin: 'requester_department_managers' }, 'hold')]);
    const id = await submitAs(requester.access);
    const held = await acceptWith(id, workflowId);
    expect(live(held)).toMatchObject({ state: 'held', assignees: [] });
    expect(held.activeStage).toEqual({ name: 'Ops approval', waitingOn: [] });

    const boss = await newMember(ops, { manager: true });
    const run = live(held);
    expect((await act('nora', id, run?.id ?? '', 'refresh')).status).toBe(403);
    const refreshed = await act('faisal', id, run?.id ?? '', 'refresh', { reason: 'boss added' });
    expect(refreshed.status).toBe(200);
    expect(live(refreshed.body.data)).toMatchObject({
      id: run?.id,
      state: 'active',
      assignees: [{ id: boss.id, name: expect.any(String) }],
    });
    const entry = (await auditActions(id)).find((e) => e.action === 'request.stage_refreshed');
    expect(entry?.details).toMatchObject({
      run: run?.id,
      before: { state: 'held', assignees: [] },
      reason: 'boss added',
    });
  });

  it('starts the next stage when a refresh finds nobody and the stage skips', async () => {
    const dept = await newUnit('Treasury');
    const requester = await newMember(dept);
    const boss = await newMember(dept, { manager: true });
    const workflowId = await offer('Skip on refresh', [stage('Treasury review', { builtin: 'requester_department_managers' }, 'skip'), stage('Drafting', { builtin: 'handler' }, 'hold')]);
    const id = await submitAs(requester.access);
    const accepted = await acceptWith(id, workflowId);
    expect(live(accepted)?.assignees).toHaveLength(1);
    await pool.query('update tenant_members set is_manager = false where user_id = $1', [boss.id]);
    const refreshed = await act('faisal', id, live(accepted)?.id ?? '', 'refresh');
    expect(names(refreshed.body.data)).toEqual(['Treasury review:skipped', 'Drafting:active']);
  });

  it('completes the request at acceptance when every stage skips (R6.13)', async () => {
    const vacant = (await pool.query<{ id: string }>("insert into positions (tenant_id, unit_id, name) values ($1, $2, 'Vacant desk') returning id", [alNoor.tenantId, alNoor.units.litigation])).rows[0]?.id;
    const workflowId = await offer('All skip', [stage('First', { position: vacant }, 'skip'), stage('Second', { position: vacant }, 'skip')]);
    const { id, request } = await open(workflowId);
    expect(request.state).toBe('completed');
    expect(names(request)).toEqual(['First:skipped', 'Second:skipped']);
    expect(request.sla).toMatchObject({ elapsedDays: 0, met: true, breachDays: 0 });
    expect(await rowOf(id)).toMatchObject({ closed_by: alNoor.ids.huda });
    const actions = (await auditActions(id)).map((entry) => entry.action);
    expect(actions).toEqual(['request.submitted', 'request.accepted', 'request.completed']);
  });

  it('refuses a refresh from anyone but the handler, and on a closed request', async () => {
    const { id, request } = await open();
    const run = live(request)?.id ?? '';
    expect((await act('huda', id, run, 'refresh')).status).toBe(403);
    expect((await act('majed', id, run, 'refresh')).status).toBe(403);
    await complete('majed', id);
    // The first run has ended.
    const ended = await act('faisal', id, run, 'refresh');
    expect(ended.status).toBe(409);
    expect(codeOf(ended)).toBe('STAGE_NOT_ACTIVE');
  });
});

describe('completing and returning (R6.14-R6.16)', () => {
  it('lets only a recorded assignee act, and the first of two to win', async () => {
    const { id } = await open();
    await complete('majed', id);
    await complete('faisal', id);
    const run = live(await detail(id))?.id ?? '';
    // Khalid and Faisal are not assignees of Supervisor sign-off.
    expect((await act('faisal', id, run, 'complete')).status).toBe(403);
    expect((await act('lina', id, run, 'complete')).status).toBe(404);

    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from requests where id = $1 for update', [id]);
      const huda = act('huda', id, run, 'complete');
      const ahmed = act('ahmed', id, run, 'complete');
      const both = Promise.all([huda, ahmed]);
      await waitUntilBlockedOn(pool, 'requests');
      await holder.query('commit');
      const results = await both;
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(loser && codeOf(loser)).toBe('STAGE_NOT_ACTIVE');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect((await rowOf(id)).state).toBe('completed');
  });

  it('checks the assignee against the database at the moment of the action (R6.14)', async () => {
    const workflowId = await offer('Procurement only', [
      stage('Procurement check', { position: alNoor.positions.procurementReviewer }, 'hold', {
        exclude: true,
      }),
    ]);
    const requester = await newMember(null);
    const id = await submitAs(requester.access);
    const accepted = await acceptWith(id, workflowId);
    expect(live(accepted)?.assignees.map((a) => a.id)).toEqual([alNoor.ids.khalid]);
    // Khalid moves out of Procurement, which clears his position; the stage still records him.
    await pool.query('update tenant_members set unit_id = $2, position_id = null where user_id = $1', [alNoor.ids.khalid, alNoor.units.litigation]);
    try {
      const res = await act('khalid', id, live(accepted)?.id ?? '', 'complete');
      expect(res.status).toBe(403);
      expect(codeOf(res)).toBe('FORBIDDEN');
      expect((await detail(id)).state).toBe('in_progress');
    } finally {
      await pool.query('update tenant_members set unit_id = $2, position_id = $3 where user_id = $1', [alNoor.ids.khalid, alNoor.units.procurement, alNoor.positions.procurementReviewer]);
    }
  });

  it('does not let a new holder of the position act until a refresh (Q16)', async () => {
    const workflowId = await offer('Supervisor only', [stage('Supervisor review', { position: alNoor.positions.contractsSupervisor }, 'hold')]);
    const { id, request } = await open(workflowId, 'huda');
    expect(live(request)?.assignees.map((a) => a.name)).toEqual(['Faisal']);
    await pool.query('update tenant_members set position_id = null where user_id = $1', [alNoor.ids.faisal]);
    await pool.query('update tenant_members set position_id = $2 where user_id = $1', [alNoor.ids.nora, alNoor.positions.contractsSupervisor]);
    try {
      const run = live(request)?.id ?? '';
      expect((await act('nora', id, run, 'complete')).status).toBe(403);
      expect((await act('faisal', id, run, 'complete')).status).toBe(403);
      const refreshed = await act('huda', id, run, 'refresh');
      expect(live(refreshed.body.data)?.assignees.map((a) => a.name)).toEqual(['Nora']);
      expect((await act('nora', id, run, 'complete')).status).toBe(200);
    } finally {
      await pool.query('update tenant_members set position_id = null where user_id = $1', [alNoor.ids.nora]);
      await pool.query('update tenant_members set position_id = $2 where user_id = $1', [alNoor.ids.faisal, alNoor.positions.contractsSupervisor]);
    }
  });

  it('cannot return from the first stage that ran, and needs a reason', async () => {
    const { id, request } = await open();
    const run = live(request)?.id ?? '';
    const first = await act('majed', id, run, 'return', { reason: 'no' });
    expect(first.status).toBe(409);
    expect(codeOf(first)).toBe('NO_EARLIER_STAGE');
    expect(detailsOf(await act('majed', id, run, 'return', {}))).toEqual([{ path: 'reason', code: 'invalid_type' }]);
    await complete('majed', id);
    const drafting = live(await detail(id))?.id ?? '';
    const back = await act('faisal', id, drafting, 'return', { reason: 'approval needs a note' });
    expect(back.status).toBe(200);
    expect(names(back.body.data)).toEqual(['Business approval:completed', 'Drafting:returned', 'Business approval:active']);
  });

  it('returns past a skipped stage: the nearest earlier stage that ran starts again (R6.16)', async () => {
    const { id } = await open();
    await complete('majed', id);
    await complete('faisal', id); // Procurement check skipped, Supervisor sign-off active
    const run = live(await detail(id))?.id ?? '';
    const res = await act('ahmed', id, run, 'return', { reason: 'redo' });
    expect(live(res.body.data)?.stage.name).toBe('Drafting');
  });

  it('starts a returned-to stage from its position, without earlier narrowing (R6.16)', async () => {
    const workflowId = await offer('Narrow then return', [stage('Legal review', { builtin: 'handler_department_managers' }, 'hold', { narrow: true }), stage('Drafting', { builtin: 'handler' }, 'hold')]);
    const { id, request } = await open(workflowId);
    expect(live(request)?.assignees.map((a) => a.name)).toEqual(['Ahmed', 'Huda']);
    const narrowed = await act('faisal', id, live(request)?.id ?? '', 'narrow', {
      userIds: [alNoor.ids.huda],
      reason: 'Huda knows this vendor',
    });
    expect(live(narrowed.body.data)).toMatchObject({ narrowed: true });
    await complete('huda', id);
    const drafting = live(await detail(id))?.id ?? '';
    const back = await act('faisal', id, drafting, 'return', {
      reason: 'needs legal review again',
    });
    const rerun = live(back.body.data);
    expect(rerun).toMatchObject({ narrowed: false, escalated: false });
    expect(rerun?.assignees.map((a) => a.name)).toEqual(['Ahmed', 'Huda']);
  });
});

describe('handler actions (R6.17)', () => {
  it('narrows to some of the assignees, and only to assignees', async () => {
    const workflowId = await offer('Narrowable', [stage('Legal review', { builtin: 'handler_department_managers' }, 'hold', { narrow: true })]);
    const { id, request } = await open(workflowId);
    const run = live(request)?.id ?? '';
    const stranger = await act('faisal', id, run, 'narrow', {
      userIds: [alNoor.ids.huda, alNoor.ids.nora],
      reason: 'r',
    });
    expect(stranger.status).toBe(400);
    expect(detailsOf(stranger)).toEqual([{ path: 'userIds.1', code: 'not_assignee' }]);
    expect((await act('huda', id, run, 'narrow', { userIds: [alNoor.ids.huda], reason: 'r' })).status).toBe(403);
    expect((await act('faisal', id, run, 'narrow', { userIds: [], reason: 'r' })).status).toBe(400);

    const ok = await act('faisal', id, run, 'narrow', {
      userIds: [alNoor.ids.ahmed],
      reason: 'Ahmed leads',
    });
    expect(ok.status).toBe(200);
    expect(live(ok.body.data)?.assignees.map((a) => a.name)).toEqual(['Ahmed']);
    // Huda is no longer an assignee.
    expect((await act('huda', id, run, 'complete')).status).toBe(403);
    const entry = (await auditActions(id)).find((e) => e.action === 'request.stage_narrowed');
    expect(entry?.details).toMatchObject({
      before: { assignees: expect.arrayContaining([alNoor.ids.huda, alNoor.ids.ahmed]) },
      after: { assignees: [alNoor.ids.ahmed] },
      reason: 'Ahmed leads',
    });
  });

  it('escalates to the next level, and refuses when the stage does not allow it or the chain ended', async () => {
    const workflowId = await offer('Escalatable', [stage('Intake', { position: alNoor.positions.legalIntake }, 'hold', { escalate: true })]);
    const { id, request } = await open(workflowId);
    const run = live(request)?.id ?? '';
    expect(live(request)?.assignees.map((a) => a.name)).toEqual(['Ahmed']);
    expect((await act('huda', id, run, 'escalate', { reason: 'r' })).status).toBe(403);
    const up = await act('faisal', id, run, 'escalate', { reason: 'Ahmed is away' });
    expect(up.status).toBe(200);
    expect(live(up.body.data)).toMatchObject({ escalated: true });
    expect(live(up.body.data)?.assignees.map((a) => a.name)).toEqual(['Ahmed', 'Huda']);
    const end = await act('faisal', id, run, 'escalate', { reason: 'again' });
    expect(codeOf(end)).toBe('NO_HIGHER_LEVEL');

    const vendor = await open();
    const notAllowed = await act('faisal', vendor.id, live(vendor.request)?.id ?? '', 'escalate', {
      reason: 'r',
    });
    expect(notAllowed.status).toBe(403);
    const narrowing = await act('faisal', vendor.id, live(vendor.request)?.id ?? '', 'narrow', {
      userIds: [alNoor.ids.majed],
      reason: 'r',
    });
    expect(narrowing.status).toBe(403);
  });

  it('does not narrow or escalate a held stage', async () => {
    const ops = await newUnit('Quiet');
    const requester = await newMember(ops);
    const workflowId = await offer('Held', [
      stage('Quiet approval', { builtin: 'requester_department_managers' }, 'hold', {
        narrow: false,
        escalate: false,
      }),
    ]);
    const id = await submitAs(requester.access);
    const held = await acceptWith(id, workflowId);
    const res = await act('faisal', id, live(held)?.id ?? '', 'complete');
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('STAGE_NOT_ACTIVE');
  });
});

describe('reassigning the handler (R6.19)', () => {
  it('makes a new handler and resolves the live stage again for them', async () => {
    const { id, request } = await open();
    await complete('majed', id);
    const drafting = live(await detail(id));
    expect(drafting?.assignees.map((a) => a.name)).toEqual(['Faisal']);
    await pool.query('update users set is_active = false where id = $1', [alNoor.ids.faisal]);
    try {
      const res = await as('ahmed').put(`/requests/${id}/handler`, {
        handlerId: alNoor.ids.nora,
        reason: 'Faisal was deactivated',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.handler.name).toBe('Nora');
      expect(live(res.body.data)).toMatchObject({ id: drafting?.id, state: 'active' });
      expect(live(res.body.data)?.assignees.map((a) => a.name)).toEqual(['Nora']);
      expect((await rowOf(id)).handler_unit_id).toBe(alNoor.units.contracts);
      expect((await act('nora', id, drafting?.id ?? '', 'complete')).status).toBe(200);
      const entry = (await auditActions(id)).find((e) => e.action === 'request.handler_changed');
      expect(entry?.details).toMatchObject({
        before: alNoor.ids.faisal,
        after: alNoor.ids.nora,
        reason: 'Faisal was deactivated',
      });
    } finally {
      await pool.query('update users set is_active = true where id = $1', [alNoor.ids.faisal]);
    }
    expect(request.state).toBe('in_progress');
  });

  it('applies the handler rules, and the permission, and the state', async () => {
    const { id } = await open();
    const send = (person: PersonType, handlerId: string) => as(person).put(`/requests/${id}/handler`, { handlerId, reason: 'r' });
    expect(detailsOf(await send('huda', alNoor.ids.faisal))).toEqual([{ path: 'handlerId', code: 'same_handler' }]);
    expect(detailsOf(await send('huda', alNoor.ids.khalid))).toEqual([{ path: 'handlerId', code: 'handler_is_requester' }]);
    expect(detailsOf(await send('huda', alNoor.ids.reem))).toEqual([{ path: 'handlerId', code: 'handler_not_eligible' }]);
    expect((await send('faisal', alNoor.ids.nora)).status).toBe(403);
    const inReview = await submitAs(alNoor.tokens.khalid);
    const early = await as('huda').put(`/requests/${inReview}/handler`, {
      handlerId: alNoor.ids.nora,
      reason: 'r',
    });
    expect(early.status).toBe(409);
    expect(codeOf(early)).toBe('INVALID_REQUEST_STATE');
  });

  it("recomputes 'exclude the parties' for the new handler (Q20)", async () => {
    const workflowId = await offer('Excluding', [stage('Intake', { position: alNoor.positions.legalIntake }, 'hold', { exclude: true })]);
    const { id, request } = await open(workflowId, 'huda');
    expect(live(request)?.assignees.map((a) => a.name)).toEqual(['Ahmed']);
    // Ahmed becomes the handler, so the stage no longer resolves to him and holds.
    const res = await as('huda').put(`/requests/${id}/handler`, {
      handlerId: alNoor.ids.ahmed,
      reason: 'Ahmed takes over',
    });
    expect(live(res.body.data)).toMatchObject({ state: 'held', assignees: [] });
  });
});

describe('who sees a request through its stage (R6.7)', () => {
  it('shows a request to the unit manager it waits on only while it waits on them', async () => {
    const workflowId = await offer('Unit sign-off', [stage('Unit sign-off', { builtin: 'requester_unit_managers' }, 'hold')]);
    const { id } = await open(workflowId);
    const status = async (person: PersonType) => (await as(person).get(`/requests/${id}`)).status;
    expect(await status('reem')).toBe(200);
    expect((await as('reem').get('/requests?view=waiting_on_me')).body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    await complete('reem', id);
    expect(await status('reem')).toBe(404);
  });
});

describe('the closure record of a completed request (R6.22, R6.23)', () => {
  it('freezes the deadline and the breach, and is not rewritten by later calendar rules', async () => {
    const workflowId = await offer('One step', [stage('Drafting', { builtin: 'handler' }, 'hold')]);
    const { id } = await open(workflowId);
    // Accepted on a Sunday three weeks ago at 10:00 Riyadh time (07:00 UTC), High is 5 working days.
    const sunday = new Date();
    sunday.setUTCDate(sunday.getUTCDate() - 21 - sunday.getUTCDay());
    const date = sunday.toISOString().slice(0, 10);
    await pool.query('update requests set accepted_at = $2 where id = $1', [id, `${date}T07:00:00Z`]);
    const done = await complete('faisal', id);
    const nextSunday = new Date(sunday);
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    expect(new Date(done.sla?.deadline ?? '').toISOString()).toBe(`${nextSunday.toISOString().slice(0, 10)}T07:00:00.000Z`);
    expect(done.sla?.met).toBe(false);
    expect(done.sla?.breachDays).toBeGreaterThan(0);
    // The deadline is exactly five working days in, so everything beyond it is the breach.
    expect((done.sla?.elapsedDays ?? 0) - 5).toBeCloseTo(done.sla?.breachDays ?? 0, 4);
    const row = await rowOf(id);
    expect(row).toMatchObject({ sla_met: false, state: 'completed' });
    expect(Number(row.awaiting_info_days)).toBe(0);

    // A holiday added to the calendar afterwards does not rewrite the closed record.
    await pool.query("insert into calendar_periods (tenant_id, kind, name, recurrence, start_date, end_date) values ($1, 'holiday', 'Added later', 'once', $2, $2)", [
      alNoor.tenantId,
      new Date(sunday.getTime() + 3 * 86_400_000).toISOString().slice(0, 10),
    ]);
    const again = await detail(id);
    expect(again.sla).toEqual(done.sla);
    const closing = (await auditActions(id)).find((e) => e.action === 'request.completed');
    expect(closing?.details.closure).toMatchObject({ met: false });
  });

  it('ends the live run as cancelled when the request closes while it is active (R6.13)', async () => {
    const { id } = await open();
    const repo = createRequestsRepository();
    await withTx(db, async (tx) => {
      const [row] = await repo.lockVisible(tx, alNoor.tenantId, id, visibleRequests(alNoor.tenantId, alNoor.ids.huda));
      if (!row) {
        throw new Error('request not found');
      }
      await closeRequest(tx, row, {
        outcome: 'rejected_no_response',
        actorId: alNoor.ids.faisal,
        reason: 'silent',
      });
    });
    const closed = await detail(id);
    expect(closed.state).toBe('rejected_no_response');
    expect(closed.stages.map((run) => run.state)).toEqual(['cancelled']);
    expect(closed.sla).not.toBeNull();
  });
});

describe('the stage tables', () => {
  it('allows one live run per request', async () => {
    const { id } = await open();
    const [stageRow] = (
      await pool.query<{ id: string; version: string }>('select s.id, r.workflow_version_id as version from workflow_stages s join requests r on r.workflow_version_id = s.version_id where r.id = $1 and s.ordinal = 2', [id])
    ).rows;
    const text = await rejectionText(
      pool.query(
        `insert into request_stage_runs (tenant_id, request_id, workflow_version_id, workflow_stage_id, ordinal, state, level, started_at)
         values ($1, $2, $3, $4, 2, 'active', '{"kind":"person","party":"handler"}', now())`,
        [alNoor.tenantId, id, stageRow?.version, stageRow?.id],
      ),
    );
    expect(text).toContain('request_stage_runs_live_unique');
  });

  it('refuses a stage of another workflow version', async () => {
    const { id } = await open();
    const foreign = (await pool.query<{ id: string }>('select s.id from workflow_stages s join workflows w on w.current_version_id = s.version_id where w.id = $1 limit 1', [alNoor.workflows.complex])).rows[0]?.id;
    const version = (await rowOf(id)).workflow_version_id;
    await pool.query("update request_stage_runs set state = 'cancelled', ended_at = now(), level = level where request_id = $1", [id]);
    const text = await rejectionText(
      pool.query(
        `insert into request_stage_runs (tenant_id, request_id, workflow_version_id, workflow_stage_id, ordinal, state, started_at)
         values ($1, $2, $3, $4, 1, 'held', now())`,
        [alNoor.tenantId, id, version, foreign],
      ),
    );
    expect(text).toContain('request_stage_runs_stage_fk');
  });
});
