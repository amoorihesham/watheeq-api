import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  connectToTestDb,
  rejectionText,
  seedRole,
  seedSubscribedTenant,
  seedUser,
  waitUntilBlockedOn,
} from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@wf-alnoor.test";
const HUDA = "huda@wf-alnoor.test";
const NORA = "nora@wf-alnoor.test";
const VIEWER = "viewer@wf-alnoor.test";
const RASHID_ADMIN = "admin@wf-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let alNoor = "";
let sara = "";
let huda = "";
let nora = "";
let viewer = "";
let rashid = "";
let rashidPosition = "";
let counter = 0;

let legal = "";
let contracts = "";
let procurement = "";

const ids = { huda: "", ahmed: "", faisal: "", khalid: "" };
const positionIds = { supervisor: "", reviewer: "", intake: "" };

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
});

const org = (key: string) => ({ key, scope: "organization" });
const nextName = (prefix: string) => `${prefix} ${++counter}`;

type Assignee = { position: string } | { builtin: string };

/** A stage with every choice spelled out; `over` changes some of them. */
const stage = (name: string, assignee: Assignee, over: Record<string, unknown> = {}) => ({
  name,
  assignee,
  whenUnresolved: "hold",
  handlerMayNarrow: false,
  handlerMayEscalate: false,
  excludeParties: false,
  ...over,
});

/** Al-Noor's "Vendor contract" stages (spec section 3). */
const vendorStages = () => [
  stage("Business approval", { builtin: "requester_department_managers" }),
  stage("Drafting", { builtin: "handler" }),
  stage(
    "Procurement check",
    { position: positionIds.reviewer },
    { whenUnresolved: "skip", excludeParties: true },
  ),
  stage(
    "Supervisor sign-off",
    { position: positionIds.supervisor },
    { whenUnresolved: "escalate", excludeParties: true, handlerMayEscalate: true },
  ),
];

const simpleStages = () => [stage("Review", { builtin: "handler" })];

async function insertUnit(
  tenantId: string,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id",
    [tenantId, parentId ? "section" : "department", parentId, name],
  );
  return rows[0]?.id ?? "";
}

async function addMember(
  userName: string,
  unitId: string | null,
  roleId: string,
  options: { manager?: boolean; email?: string; passwordHash?: string } = {},
): Promise<string> {
  const id = await seedUser(pool, {
    email: options.email ?? `${userName.toLowerCase()}.${++counter}@wf-alnoor.test`,
    userName,
    ...(options.passwordHash ? { passwordHash: options.passwordHash } : {}),
  });
  await pool.query(
    "insert into tenant_members (tenant_id, user_id, role_id, unit_id, is_manager) values ($1, $2, $3, $4, $5)",
    [alNoor, id, roleId, unitId, options.manager ?? false],
  );
  return id;
}

async function createPosition(name: string, unitId: string, holders: string[] = []) {
  const res = await as(huda).post("/positions", { unitId, name });
  expect(res.status).toBe(201);
  if (holders.length > 0) {
    const held = await as(huda).put(`/positions/${res.body.position.id}/holders`, {
      userIds: holders,
    });
    expect(held.status).toBe(200);
  }
  return res.body.position.id as string;
}

/** Creates a workflow as Huda through the API. Returns its id. */
async function createWorkflow(
  name: string,
  stages: object[] = simpleStages(),
  token = huda,
): Promise<string> {
  const res = await as(token).post("/workflows", { name, stages });
  expect(res.status).toBe(201);
  return res.body.workflow.id;
}

const save = (id: string, body: object, token = huda) => as(token).put(`/workflows/${id}`, body);

const versionCountOf = (workflowId: string) =>
  pool
    .query("select count(*)::int as n from workflow_versions where workflow_id = $1", [workflowId])
    .then((result) => result.rows[0].n as number);

const auditOf = (resourceId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_type, actor_id, details from audit_log where resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

/** Resolves once at least `count` statements on `table` wait for a lock. */
async function waitForBlocked(table: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await pool.query(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike $1",
      [`%${table}%`],
    );
    if (rows[0].waiting >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`fewer than ${count} statements on ${table} became blocked`);
}

/**
 * Runs `during` inside a transaction that holds `lockSql`, then commits. The lock is released even when
 * `during` fails, so a failing race test cannot hang the ones after it.
 */
async function whileHolding(
  lockSql: string,
  params: unknown[],
  during: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(lockSql, params);
    await during(client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, "wf-al-noor", [
    { email: SARA, userName: "Sara", passwordHash },
  ]);
  alNoor = tenant.id;
  const headOfLegal = await seedRole(pool, alNoor, {
    name: "Head of Legal",
    permissions: [
      "org.view",
      "user.view",
      "position.view",
      "position.manage",
      "workflow.view",
      "workflow.manage",
    ].map(org),
  });
  const viewerRole = await seedRole(pool, alNoor, {
    name: "Workflow Viewer",
    permissions: [org("workflow.view")],
  });

  legal = await insertUnit(alNoor, "Legal Affairs");
  contracts = await insertUnit(alNoor, "Contracts", legal);
  const finance = await insertUnit(alNoor, "Finance");
  procurement = await insertUnit(alNoor, "Procurement", finance);

  ids.huda = await addMember("Huda", legal, headOfLegal, {
    manager: true,
    email: HUDA,
    passwordHash,
  });
  ids.ahmed = await addMember("Ahmed", legal, tenant.memberRoleId, { manager: true });
  ids.faisal = await addMember("Faisal", contracts, tenant.memberRoleId, { manager: true });
  await addMember("Nora", contracts, tenant.memberRoleId, { email: NORA, passwordHash });
  ids.khalid = await addMember("Khalid", procurement, tenant.memberRoleId);
  await addMember("Viewer", null, viewerRole, { email: VIEWER, passwordHash });

  huda = (await login(app, HUDA, PASSWORD)).access;
  positionIds.supervisor = await createPosition("Contracts Supervisor", contracts, [ids.faisal]);
  positionIds.reviewer = await createPosition("Procurement Reviewer", procurement, [ids.khalid]);
  positionIds.intake = await createPosition("Legal Intake", legal, [ids.ahmed]);

  const rashidTenant = await seedSubscribedTenant(pool, "wf-al-rashid", [
    { email: RASHID_ADMIN, passwordHash },
  ]);
  const rashidUnit = await insertUnit(rashidTenant.id, "Legal Affairs");

  sara = (await login(app, SARA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
  const theirs = await as(rashid).post("/positions", { unitId: rashidUnit, name: "Their Post" });
  rashidPosition = theirs.body.position.id;
});

afterAll(async () => {
  await pool.end();
});

describe("creating workflows (R5.8)", () => {
  it("creates Al-Noor's Vendor contract as version 1, and audits it", async () => {
    const stages = vendorStages();
    const res = await as(huda).post("/workflows", { name: "  Vendor contract  ", stages });
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.workflow).toEqual({
      id: expect.any(String),
      name: "Vendor contract",
      retired: false,
      versionCount: 1,
      version: {
        number: 1,
        createdAt: expect.any(String),
        createdBy: ids.huda,
        stages: [
          { id: expect.any(String), ...stages[0] },
          { id: expect.any(String), ...stages[1] },
          {
            id: expect.any(String),
            ...stages[2],
            assignee: { position: positionIds.reviewer, name: "Procurement Reviewer" },
          },
          {
            id: expect.any(String),
            ...stages[3],
            assignee: { position: positionIds.supervisor, name: "Contracts Supervisor" },
          },
        ],
      },
    });
    expect(await auditOf(res.body.workflow.id)).toEqual([
      {
        action: "workflow.created",
        tenant_id: alNoor,
        actor_type: "user",
        actor_id: ids.huda,
        details: { name: "Vendor contract", version: 1, stages },
      },
    ]);
  });

  it("creates Complex contract with a fifth stage for the handler's department managers", async () => {
    const stages = [
      ...vendorStages(),
      stage("Legal Affairs approval", { builtin: "handler_department_managers" }),
    ];
    const res = await as(huda).post("/workflows", { name: "Complex contract", stages });
    expect(res.status).toBe(201);
    expect(res.body.workflow.version.stages.map((s: { name: string }) => s.name)).toEqual([
      "Business approval",
      "Drafting",
      "Procurement check",
      "Supervisor sign-off",
      "Legal Affairs approval",
    ]);
  });

  it("keeps the order of the stages as sent", async () => {
    const id = await createWorkflow(nextName("Ordered"), [
      stage("Zulu", { builtin: "handler" }),
      stage("Alpha", { builtin: "requester" }),
      stage("Mike", { builtin: "requester_unit_managers" }),
    ]);
    const read = await as(huda).get(`/workflows/${id}`);
    expect(read.body.workflow.version.stages.map((s: { name: string }) => s.name)).toEqual([
      "Zulu",
      "Alpha",
      "Mike",
    ]);
  });

  it("accepts 20 stages", async () => {
    const stages = Array.from({ length: 20 }, (_, i) =>
      stage(`Step ${i + 1}`, { builtin: "handler" }),
    );
    expect((await as(huda).post("/workflows", { name: nextName("Long"), stages })).status).toBe(
      201,
    );
  });

  it("refuses a second name in any case", async () => {
    const name = nextName("Unique Flow");
    await createWorkflow(name);
    const res = await as(huda).post("/workflows", {
      name: name.toUpperCase(),
      stages: simpleStages(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKFLOW_NAME_TAKEN");
  });

  it("leaves nothing behind when the name is taken", async () => {
    const name = nextName("Clean Failure");
    await createWorkflow(name);
    const before = await pool.query("select count(*)::int as n from workflow_versions");
    await as(huda).post("/workflows", { name, stages: simpleStages() });
    const after = await pool.query("select count(*)::int as n from workflow_versions");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("stage validation (R5.8, R5.10)", () => {
  const detailsOf = async (stages: object[], name = nextName("Invalid")) => {
    const res = await as(huda).post("/workflows", { name, stages });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    return res.body.error.details;
  };

  it("requires at least one stage", async () => {
    expect(await detailsOf([])).toEqual([{ path: "stages", code: "too_small" }]);
  });

  it("refuses more than 20 stages", async () => {
    const stages = Array.from({ length: 21 }, (_, i) =>
      stage(`Step ${i + 1}`, { builtin: "handler" }),
    );
    expect(await detailsOf(stages)).toEqual([{ path: "stages", code: "too_many_stages" }]);
  });

  it("refuses two stages with the same name, ignoring case, at the later one", async () => {
    const details = await detailsOf([
      stage("Review", { builtin: "handler" }),
      stage("Sign", { builtin: "handler" }),
      stage("  review ", { builtin: "requester" }),
    ]);
    expect(details).toEqual([{ path: "stages.2.name", code: "duplicate_name" }]);
  });

  it("refuses narrowing or excluding the parties on Handler and Requester stages", async () => {
    const details = await detailsOf([
      stage("A", { builtin: "handler" }, { handlerMayNarrow: true }),
      stage("B", { builtin: "requester" }, { excludeParties: true }),
      stage("C", { builtin: "handler" }, { handlerMayNarrow: true, excludeParties: true }),
    ]);
    expect(details).toEqual([
      { path: "stages.0.handlerMayNarrow", code: "not_allowed" },
      { path: "stages.1.excludeParties", code: "not_allowed" },
      { path: "stages.2.handlerMayNarrow", code: "not_allowed" },
      { path: "stages.2.excludeParties", code: "not_allowed" },
    ]);
  });

  it("allows narrowing and excluding on the managers built-ins and on positions", async () => {
    const id = await createWorkflow(nextName("Allowed Flags"), [
      stage(
        "A",
        { builtin: "handler_unit_managers" },
        { handlerMayNarrow: true, excludeParties: true },
      ),
      stage(
        "B",
        { position: positionIds.intake },
        { handlerMayNarrow: true, excludeParties: true },
      ),
    ]);
    expect(id).toBeTruthy();
  });

  it("requires every field of a stage, and rejects unknown ones", async () => {
    const { handlerMayNarrow: _narrow, ...partial } = simpleStages()[0] as Record<string, unknown>;
    expect(await detailsOf([partial])).toEqual([
      { path: "stages.0.handlerMayNarrow", code: "invalid_type" },
    ]);
    expect(await detailsOf([{ ...simpleStages()[0], extra: 1 }])).toEqual([
      { path: "stages.0.extra", code: "unknown_field" },
    ]);
  });

  it("rejects a malformed target, fallback, and name", async () => {
    const details = await detailsOf([
      stage("", { builtin: "handler" }),
      stage("B", { builtin: "approver" }, { whenUnresolved: "ignore" }),
      stage("C", { position: positionIds.intake, builtin: "handler" }),
    ]);
    expect(details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(["stages.0.name", "stages.1.whenUnresolved", "stages.2.assignee"]),
    );
  });

  it("refuses an unknown position and one of another tenant, per stage", async () => {
    const details = await detailsOf([
      stage("A", { builtin: "handler" }),
      stage("B", { position: rashidPosition }),
      stage("C", { position: "00000000-0000-4000-8000-000000000000" }),
    ]);
    expect(details).toEqual([
      { path: "stages.1.assignee.position", code: "unknown_position" },
      { path: "stages.2.assignee.position", code: "unknown_position" },
    ]);
  });

  it("refuses a retired position", async () => {
    const retired = await createPosition(nextName("Old Post"), contracts);
    expect((await as(huda).post(`/positions/${retired}/retire`)).status).toBe(200);
    const details = await detailsOf([stage("A", { position: retired })]);
    expect(details).toEqual([{ path: "stages.0.assignee.position", code: "position_retired" }]);
  });
});

describe("reading workflows", () => {
  it("lists active workflows by name, with the current version's header", async () => {
    const a = await createWorkflow(nextName("List Beta"));
    const b = await createWorkflow(nextName("List Alpha"));
    const res = await as(huda).get("/workflows");
    expect(res.status).toBe(200);
    const mine = res.body.workflows.filter((w: { id: string }) => [a, b].includes(w.id));
    expect(mine.map((w: { id: string }) => w.id)).toEqual([b, a]);
    expect(mine[0]).toEqual({
      id: b,
      name: expect.stringContaining("List Alpha"),
      retired: false,
      versionCount: 1,
      version: { number: 1, createdAt: expect.any(String), createdBy: ids.huda },
    });
    expect(mine[0]).not.toHaveProperty("stages");
  });

  it("hides retired workflows unless asked", async () => {
    const id = await createWorkflow(nextName("Hidden"));
    await as(huda).post(`/workflows/${id}/retire`);
    const active = await as(huda).get("/workflows");
    expect(active.body.workflows.map((w: { id: string }) => w.id)).not.toContain(id);
    const all = await as(huda).get("/workflows?includeRetired=true");
    expect(all.body.workflows.find((w: { id: string }) => w.id === id).retired).toBe(true);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    for (const path of [
      "/workflows/00000000-0000-4000-8000-000000000000",
      "/workflows/not-a-uuid",
      "/workflows/not-a-uuid/versions/1",
    ]) {
      expect((await as(huda).get(path)).status).toBe(404);
    }
  });
});

describe("versions (R5.9)", () => {
  it("creates version 2 when the stages change, and keeps version 1 readable and unchanged", async () => {
    const id = await createWorkflow("Versioned", vendorStages().slice(0, 2));
    const v1 = (await as(huda).get(`/workflows/${id}/versions/1`)).body.version;

    const stages = [...vendorStages().slice(0, 2), stage("Negotiation", { builtin: "requester" })];
    const res = await save(id, { name: "Versioned", baseVersion: 1, stages });
    expect(res.status).toBe(200);
    expect(res.body.workflow.versionCount).toBe(2);
    expect(res.body.workflow.version.number).toBe(2);
    expect(res.body.workflow.version.createdBy).toBe(ids.huda);
    expect(res.body.workflow.version.stages.map((s: { name: string }) => s.name)).toEqual([
      "Business approval",
      "Drafting",
      "Negotiation",
    ]);

    const again = await as(huda).get(`/workflows/${id}/versions/1`);
    expect(again.status).toBe(200);
    expect(again.body.version).toEqual(v1);
    expect(again.body.version.stages).toHaveLength(2);
    const current = await as(huda).get(`/workflows/${id}`);
    expect(current.body.workflow.version.number).toBe(2);
    expect((await as(huda).get(`/workflows/${id}/versions/2`)).body.version).toEqual(
      res.body.workflow.version,
    );
    expect(await auditOf(id)).toEqual([
      expect.objectContaining({ action: "workflow.created" }),
      {
        action: "workflow.updated",
        tenant_id: alNoor,
        actor_type: "user",
        actor_id: ids.huda,
        details: {
          before: { name: "Versioned" },
          after: { name: "Versioned" },
          version: 2,
          stages,
        },
      },
    ]);
  });

  it("gives a new version its own stage rows and leaves the old ones untouched", async () => {
    const id = await createWorkflow(nextName("Rows"), simpleStages());
    const before = await pool.query(
      "select s.id, s.name from workflow_stages s join workflow_versions v on v.id = s.version_id where v.workflow_id = $1",
      [id],
    );
    await save(id, {
      name: (await as(huda).get(`/workflows/${id}`)).body.workflow.name,
      baseVersion: 1,
      stages: [stage("Changed", { builtin: "handler" })],
    });
    const after = await pool.query(
      "select s.id, s.name, v.number from workflow_stages s join workflow_versions v on v.id = s.version_id where v.workflow_id = $1 order by v.number",
      [id],
    );
    expect(after.rows).toHaveLength(2);
    expect(after.rows[0]).toMatchObject({ id: before.rows[0].id, name: before.rows[0].name });
    expect(after.rows[1].id).not.toBe(before.rows[0].id);
  });

  it("counts a reordered stage list, a changed choice, and a changed target as changes", async () => {
    const name = nextName("Changes");
    const base = [
      stage("One", { builtin: "handler" }),
      stage("Two", { position: positionIds.intake }),
    ];
    const id = await createWorkflow(name, base);
    const variants = [
      [base[1], base[0]],
      [base[0], { ...base[1], whenUnresolved: "skip" }],
      [base[0], { ...base[1], handlerMayEscalate: true }],
      [base[0], { ...base[1], assignee: { builtin: "requester" } }],
      [base[0], { ...base[1], name: "Deux" }],
    ];
    let baseVersion = 1;
    for (const stages of variants) {
      const res = await save(id, { name, baseVersion, stages });
      expect(res.status).toBe(200);
      expect(res.body.workflow.version.number).toBe(++baseVersion);
    }
  });

  it("creates no version for a rename alone, and audits only the name", async () => {
    const id = await createWorkflow("Before Rename", vendorStages());
    const res = await save(id, {
      name: "After Rename",
      baseVersion: 1,
      stages: vendorStages(),
    });
    expect(res.status).toBe(200);
    expect(res.body.workflow.name).toBe("After Rename");
    expect(res.body.workflow.version.number).toBe(1);
    expect(await versionCountOf(id)).toBe(1);
    const entries = await auditOf(id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      action: "workflow.updated",
      details: { before: { name: "Before Rename" }, after: { name: "After Rename" } },
    });
    expect(entries[1].details).not.toHaveProperty("version");
  });

  it("changes nothing and audits nothing when the save equals the current version", async () => {
    const name = nextName("Same");
    const id = await createWorkflow(name, vendorStages());
    const before = (await as(huda).get(`/workflows/${id}`)).body;
    const res = await save(id, { name, baseVersion: 1, stages: vendorStages() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before);
    expect(await versionCountOf(id)).toBe(1);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("renames and changes stages in one save: one version, one audit entry", async () => {
    const id = await createWorkflow(nextName("Both Old"));
    const res = await save(id, {
      name: nextName("Both New"),
      baseVersion: 1,
      stages: [stage("Other", { builtin: "requester" })],
    });
    expect(res.body.workflow.version.number).toBe(2);
    expect(await auditOf(id)).toHaveLength(2);
  });

  it("refuses a save based on an older version, and changes nothing", async () => {
    const name = nextName("Stale");
    const id = await createWorkflow(name);
    const huda1 = await save(id, {
      name,
      baseVersion: 1,
      stages: [stage("Negotiation", { builtin: "requester" })],
    });
    expect(huda1.status).toBe(200);

    const ahmed = await save(id, {
      name: nextName("Ahmed Rename"),
      baseVersion: 1,
      stages: [stage("Ahmed's stage", { builtin: "handler" })],
    });
    expect(ahmed.status).toBe(409);
    expect(ahmed.body.error.code).toBe("WORKFLOW_VERSION_CHANGED");
    const read = (await as(huda).get(`/workflows/${id}`)).body.workflow;
    expect(read.name).toBe(name);
    expect(read.version.stages.map((s: { name: string }) => s.name)).toEqual(["Negotiation"]);
    expect(await auditOf(id)).toHaveLength(2);

    const future = await save(id, { name, baseVersion: 7, stages: simpleStages() });
    expect(future.body.error.code).toBe("WORKFLOW_VERSION_CHANGED");
  });

  it("refuses a save that names a taken workflow name, creating no version", async () => {
    const taken = nextName("Taken Name");
    await createWorkflow(taken);
    const name = nextName("Wants Taken");
    const id = await createWorkflow(name);
    const res = await save(id, {
      name: taken.toLowerCase(),
      baseVersion: 1,
      stages: [stage("New", { builtin: "handler" })],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKFLOW_NAME_TAKEN");
    expect(await versionCountOf(id)).toBe(1);
  });

  it("allows changing only the case of the name", async () => {
    const id = await createWorkflow("case flow");
    const res = await save(id, { name: "Case Flow", baseVersion: 1, stages: simpleStages() });
    expect(res.status).toBe(200);
    expect(res.body.workflow.name).toBe("Case Flow");
  });

  it("refuses a retired workflow", async () => {
    const name = nextName("Frozen");
    const id = await createWorkflow(name);
    await as(huda).post(`/workflows/${id}/retire`);
    const res = await save(id, {
      name,
      baseVersion: 1,
      stages: [stage("X", { builtin: "handler" })],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_RETIRED");
    expect((await as(huda).get(`/workflows/${id}`)).status).toBe(200);
  });

  it("validates the stages of a save, naming retired and foreign positions", async () => {
    const name = nextName("Save Validation");
    const id = await createWorkflow(name);
    const retired = await createPosition(nextName("Save Old Post"), contracts);
    await as(huda).post(`/positions/${retired}/retire`);
    const res = await save(id, {
      name,
      baseVersion: 1,
      stages: [stage("A", { position: retired }), stage("B", { position: rashidPosition })],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: "stages.0.assignee.position", code: "position_retired" },
      { path: "stages.1.assignee.position", code: "unknown_position" },
    ]);
    expect(await versionCountOf(id)).toBe(1);
  });

  it("requires baseVersion and a name, and rejects unknown fields", async () => {
    const id = await createWorkflow(nextName("Body"));
    const res = await save(id, { stages: simpleStages(), extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: "name", code: "invalid_type" },
        { path: "baseVersion", code: "invalid_type" },
        { path: "extra", code: "unknown_field" },
      ]),
    );
  });

  it("answers 404 for a missing version number", async () => {
    const id = await createWorkflow(nextName("Numbers"));
    for (const number of ["2", "0", "-1", "abc", "1.5", "99999999999"]) {
      expect((await as(huda).get(`/workflows/${id}/versions/${number}`)).status).toBe(404);
    }
    expect(
      (await as(huda).get("/workflows/00000000-0000-4000-8000-000000000000/versions/1")).status,
    ).toBe(404);
  });
});

describe("the database guards versions and stages (R5.8, R5.10)", () => {
  async function stageRow(overrides: Record<string, unknown>) {
    const id = await createWorkflow(nextName("Guard"));
    const { rows } = await pool.query(
      "select s.*, v.id as vid from workflow_stages s join workflow_versions v on v.id = s.version_id where v.workflow_id = $1",
      [id],
    );
    const row = { ...rows[0], ...overrides };
    delete row.id;
    return { row, id };
  }

  const insertStage = (row: Record<string, unknown>) =>
    pool.query(
      `insert into workflow_stages (tenant_id, version_id, ordinal, name, target_position_id, target_builtin,
         when_unresolved, handler_may_narrow, handler_may_escalate, exclude_parties)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.tenant_id,
        row.version_id,
        row.ordinal,
        row.name,
        row.target_position_id,
        row.target_builtin,
        row.when_unresolved,
        row.handler_may_narrow,
        row.handler_may_escalate,
        row.exclude_parties,
      ],
    );

  it("refuses a stage with two targets or none", async () => {
    const both = await stageRow({
      ordinal: 2,
      name: "Both",
      target_position_id: positionIds.intake,
      target_builtin: "handler",
    });
    expect(await rejectionText(insertStage(both.row))).toContain("workflow_stages_one_target");
    const none = await stageRow({
      ordinal: 2,
      name: "None",
      target_position_id: null,
      target_builtin: null,
    });
    expect(await rejectionText(insertStage(none.row))).toContain("workflow_stages_one_target");
  });

  it("refuses narrowing or excluding on Handler and Requester stages", async () => {
    const narrow = await stageRow({
      ordinal: 2,
      name: "Narrow",
      target_position_id: null,
      target_builtin: "requester",
      handler_may_narrow: true,
    });
    expect(await rejectionText(insertStage(narrow.row))).toContain("workflow_stages_party_flags");
  });

  it("refuses a duplicate ordinal, a duplicate name in a version, and an ordinal over 20", async () => {
    const { row } = await stageRow({});
    const handler = { target_position_id: null, target_builtin: "handler" };
    expect(await rejectionText(insertStage({ ...row, ...handler, name: "Other" }))).toContain(
      "workflow_stages_ordinal_unique",
    );
    expect(
      await rejectionText(
        insertStage({ ...row, ...handler, ordinal: 2, name: (row.name as string).toUpperCase() }),
      ),
    ).toContain("workflow_stages_name_unique");
    expect(
      await rejectionText(insertStage({ ...row, ...handler, ordinal: 21, name: "High" })),
    ).toContain("workflow_stages_ordinal_range");
  });

  it("refuses a position of another tenant as a target", async () => {
    const foreign = await stageRow({
      ordinal: 2,
      name: "Foreign",
      target_position_id: rashidPosition,
      target_builtin: null,
    });
    expect(await rejectionText(insertStage(foreign.row))).toContain("workflow_stages_position_fk");
  });

  it("refuses a current version that belongs to another workflow", async () => {
    const a = await createWorkflow(nextName("Own A"));
    const b = await createWorkflow(nextName("Own B"));
    const { rows } = await pool.query("select id from workflow_versions where workflow_id = $1", [
      b,
    ]);
    expect(
      await rejectionText(
        pool.query("update workflows set current_version_id = $1 where id = $2", [rows[0].id, a]),
      ),
    ).toContain("workflows_current_version_fk");
  });
});

describe("retiring and restoring (R5.15)", () => {
  it("retires and restores, audited, and repeating either changes nothing", async () => {
    const id = await createWorkflow(nextName("Cycle"));
    const retired = await as(huda).post(`/workflows/${id}/retire`);
    expect(retired.status).toBe(200);
    expect(retired.body.workflow.retired).toBe(true);
    expect((await as(huda).post(`/workflows/${id}/retire`)).status).toBe(200);

    const restored = await as(huda).post(`/workflows/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.workflow.retired).toBe(false);
    expect((await as(huda).post(`/workflows/${id}/restore`)).status).toBe(200);

    expect((await auditOf(id)).map((entry) => entry.action)).toEqual([
      "workflow.created",
      "workflow.retired",
      "workflow.restored",
    ]);
  });

  it("frees the name on retire, and refuses to restore it once the name is reused", async () => {
    const name = nextName("Reused");
    const old = await createWorkflow(name);
    await as(huda).post(`/workflows/${old}/retire`);
    const replacement = await createWorkflow(name);
    expect(replacement).not.toBe(old);

    const res = await as(huda).post(`/workflows/${old}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKFLOW_NAME_TAKEN");
    expect((await as(huda).get(`/workflows/${old}`)).body.workflow.retired).toBe(true);
  });

  it("answers 404 for an unknown workflow", async () => {
    for (const action of ["retire", "restore"]) {
      expect(
        (await as(huda).post(`/workflows/00000000-0000-4000-8000-000000000000/${action}`)).status,
      ).toBe(404);
    }
  });
});

describe("a position in use cannot be retired (R5.16)", () => {
  it("refuses retiring a position named by the current version of an active workflow", async () => {
    const position = await createPosition(nextName("Named Post"), legal);
    const name = nextName("Naming Flow");
    await createWorkflow(name, [stage("A", { position })]);
    const res = await as(huda).post(`/positions/${position}/retire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POSITION_IN_USE");
    expect((await as(huda).get(`/positions/${position}`)).body.position.retired).toBe(false);
  });

  it("refuses retiring Legal Intake while a workflow names it, with its holders kept", async () => {
    await createWorkflow(nextName("Intake Flow"), [
      stage("Intake", { position: positionIds.intake }),
    ]);
    expect((await as(huda).post(`/positions/${positionIds.intake}/retire`)).status).toBe(409);
    const read = await as(huda).get(`/positions/${positionIds.intake}`);
    expect(read.body.position.holders.map((h: { userId: string }) => h.userId)).toEqual([
      ids.ahmed,
    ]);
  });

  it("allows it when only an older version names the position", async () => {
    const position = await createPosition(nextName("Old Version Post"), legal);
    const name = nextName("Moved On");
    const id = await createWorkflow(name, [stage("A", { position })]);
    await save(id, { name, baseVersion: 1, stages: [stage("A", { builtin: "handler" })] });
    expect((await as(huda).post(`/positions/${position}/retire`)).status).toBe(200);
    const v1 = await as(huda).get(`/workflows/${id}/versions/1`);
    expect(v1.body.version.stages[0].assignee).toEqual({ position, name: expect.any(String) });
  });

  it("allows it when the only workflow naming the position is retired", async () => {
    const position = await createPosition(nextName("Retired Flow Post"), legal);
    const id = await createWorkflow(nextName("Retired Flow"), [stage("A", { position })]);
    await as(huda).post(`/workflows/${id}/retire`);
    expect((await as(huda).post(`/positions/${position}/retire`)).status).toBe(200);
  });

  it("allows it once the workflow stops naming the position", async () => {
    const position = await createPosition(nextName("Released Post"), legal);
    const name = nextName("Releasing Flow");
    const id = await createWorkflow(name, [stage("A", { position })]);
    expect((await as(huda).post(`/positions/${position}/retire`)).status).toBe(409);
    await save(id, { name, baseVersion: 1, stages: [stage("A", { builtin: "handler" })] });
    expect((await as(huda).post(`/positions/${position}/retire`)).status).toBe(200);
  });

  it("does not count a workflow of another tenant", async () => {
    const position = await createPosition(nextName("Isolated Post"), legal);
    const rashidUnit = (
      await pool.query(
        "select id from org_units where tenant_id = (select tenant_id from positions where id = $1)",
        [rashidPosition],
      )
    ).rows[0].id;
    const theirs = await as(rashid).post("/positions", { unitId: rashidUnit, name: nextName("R") });
    await as(rashid).post("/workflows", {
      name: nextName("Rashid Flow"),
      stages: [stage("A", { position: theirs.body.position.id })],
    });
    expect((await as(huda).post(`/positions/${position}/retire`)).status).toBe(200);
    expect((await as(rashid).post(`/positions/${theirs.body.position.id}/retire`)).status).toBe(
      409,
    );
  });
});

describe("races (section 5)", () => {
  it("serializes two saves from the same version: one wins, the other gets WORKFLOW_VERSION_CHANGED", async () => {
    const name = nextName("Race Saves");
    const id = await createWorkflow(name);
    const body = (stageName: string) => ({
      name,
      baseVersion: 1,
      stages: [stage(stageName, { builtin: "handler" })],
    });

    let saves: Promise<request.Response>[] = [];
    await whileHolding("select id from workflows where id = $1 for update", [id], async () => {
      saves = [
        save(id, body("Huda's stage")).then((res) => res),
        save(id, body("Ahmed's stage")).then((res) => res),
      ];
      await waitForBlocked("workflows", 2);
    });
    const results = await Promise.all(saves);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const loser = results.find((res) => res.status === 409);
    expect(loser?.body.error.code).toBe("WORKFLOW_VERSION_CHANGED");
    expect(await versionCountOf(id)).toBe(2);
    const winner = results.find((res) => res.status === 200);
    const read = (await as(huda).get(`/workflows/${id}`)).body.workflow;
    expect(read.version.stages).toEqual(winner?.body.workflow.version.stages);
  });

  it("refuses a save naming a position whose retire is in flight", async () => {
    const position = await createPosition(nextName("Race Retire Post"), legal);
    const name = nextName("Race Save Flow");
    const id = await createWorkflow(name);

    let saving: Promise<request.Response> = Promise.reject(new Error("not started"));
    saving.catch(() => undefined);
    await whileHolding(
      "select id from positions where id = $1 for update",
      [position],
      async (client) => {
        saving = save(id, { name, baseVersion: 1, stages: [stage("A", { position })] }).then(
          (res) => res,
        );
        await waitUntilBlockedOn(pool, "positions");
        await client.query("update positions set retired_at = now() where id = $1", [position]);
      },
    );
    const res = await saving;

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: "stages.0.assignee.position", code: "position_retired" },
    ]);
    expect(await versionCountOf(id)).toBe(1);
  });

  it("refuses retiring a position whose workflow save is in flight", async () => {
    const position = await createPosition(nextName("Race Save Post"), legal);
    const name = nextName("Race Retire Flow");
    const id = await createWorkflow(name);

    let retiring: Promise<request.Response> = Promise.reject(new Error("not started"));
    retiring.catch(() => undefined);
    // A save in flight: it holds the share lock and has written the new version.
    await whileHolding(
      "select id from positions where id = $1 for share",
      [position],
      async (client) => {
        retiring = as(huda)
          .post(`/positions/${position}/retire`)
          .then((res) => res);
        await waitUntilBlockedOn(pool, "positions");
        const versionId = "11111111-1111-4111-8111-111111111111";
        await client.query(
          "insert into workflow_versions (id, tenant_id, workflow_id, number, created_by) values ($1, $2, $3, 2, $4)",
          [versionId, alNoor, id, ids.huda],
        );
        await client.query(
          `insert into workflow_stages (tenant_id, version_id, ordinal, name, target_position_id,
           when_unresolved, handler_may_narrow, handler_may_escalate, exclude_parties)
         values ($1, $2, 1, 'A', $3, 'hold', false, false, false)`,
          [alNoor, versionId, position],
        );
        await client.query("update workflows set current_version_id = $1 where id = $2", [
          versionId,
          id,
        ]);
      },
    );
    const res = await retiring;

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POSITION_IN_USE");
    expect((await as(huda).get(`/positions/${position}`)).body.position.retired).toBe(false);
  });
});

describe("authorization (R5.17)", () => {
  it("refuses a member with no workflow permissions", async () => {
    const id = await createWorkflow(nextName("Guarded"));
    const stages = simpleStages();
    for (const res of [
      await as(nora).get("/workflows"),
      await as(nora).get(`/workflows/${id}`),
      await as(nora).get(`/workflows/${id}/versions/1`),
      await as(nora).post("/workflows", { name: "X", stages }),
      await as(nora).put(`/workflows/${id}`, { name: "X", baseVersion: 1, stages }),
      await as(nora).post(`/workflows/${id}/retire`),
      await as(nora).post(`/workflows/${id}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("lets workflow.view read but not change", async () => {
    const name = nextName("Viewable");
    const id = await createWorkflow(name);
    expect((await as(viewer).get("/workflows")).status).toBe(200);
    expect((await as(viewer).get(`/workflows/${id}`)).status).toBe(200);
    expect((await as(viewer).get(`/workflows/${id}/versions/1`)).status).toBe(200);
    expect(
      (await as(viewer).post("/workflows", { name: "Y", stages: simpleStages() })).status,
    ).toBe(403);
    expect((await save(id, { name, baseVersion: 1, stages: simpleStages() }, viewer)).status).toBe(
      403,
    );
    expect((await as(viewer).post(`/workflows/${id}/retire`)).status).toBe(403);
  });

  it("lets the Tenant Admin manage without any role change", async () => {
    const res = await as(sara).post("/workflows", {
      name: nextName("Admin Flow"),
      stages: simpleStages(),
    });
    expect(res.status).toBe(201);
    expect(res.body.workflow.version.createdBy).not.toBe(ids.huda);
  });

  it("requires a signed-in user", async () => {
    expect((await request(app).get("/workflows")).status).toBe(401);
  });
});

describe("Read-only subscriptions (R5.18)", () => {
  it("refuses changes and still shows workflows", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "wf-read-only", [
      { email: "admin@wf-read-only.test", passwordHash },
    ]);
    const admin = (await login(app, "admin@wf-read-only.test", PASSWORD)).access;
    const id = await createWorkflow("Before Expiry", simpleStages(), admin);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const stages = simpleStages();
    const writes = [
      await as(admin).post("/workflows", { name: "Late", stages }),
      await save(id, { name: "Late", baseVersion: 1, stages }, admin),
      await as(admin).post(`/workflows/${id}/retire`),
      await as(admin).post(`/workflows/${id}/restore`),
    ];
    for (const res of writes) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    }
    expect((await as(admin).get("/workflows")).status).toBe(200);
    expect((await as(admin).get(`/workflows/${id}`)).status).toBe(200);
  });
});

describe("tenant isolation (R5.19)", () => {
  it("shows each tenant only its own workflows, and answers 404 across tenants", async () => {
    const mine = await createWorkflow(nextName("Al-Noor Only"));
    const theirsRes = await as(rashid).post("/workflows", {
      name: "Al-Rashid Only",
      stages: simpleStages(),
    });
    expect(theirsRes.status).toBe(201);
    const theirs = theirsRes.body.workflow.id;

    const noorIds = (await as(huda).get("/workflows")).body.workflows.map(
      (workflow: { id: string }) => workflow.id,
    );
    const rashidIds = (await as(rashid).get("/workflows")).body.workflows.map(
      (workflow: { id: string }) => workflow.id,
    );
    expect(noorIds).toContain(mine);
    expect(noorIds).not.toContain(theirs);
    expect(rashidIds).toContain(theirs);
    expect(rashidIds).not.toContain(mine);

    const stages = simpleStages();
    expect((await as(huda).get(`/workflows/${theirs}`)).status).toBe(404);
    expect((await as(huda).get(`/workflows/${theirs}/versions/1`)).status).toBe(404);
    expect((await save(theirs, { name: "Hijack", baseVersion: 1, stages })).status).toBe(404);
    expect((await as(huda).post(`/workflows/${theirs}/retire`)).status).toBe(404);
    expect((await as(huda).post(`/workflows/${theirs}/restore`)).status).toBe(404);
  });

  it("lets two tenants use the same workflow name", async () => {
    const name = nextName("Shared Name");
    await createWorkflow(name);
    const res = await as(rashid).post("/workflows", { name, stages: simpleStages() });
    expect(res.status).toBe(201);
  });
});
