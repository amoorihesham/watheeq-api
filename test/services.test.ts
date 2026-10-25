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
  waitUntilBlockedOn,
} from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@svc-alnoor.test";
const HUDA = "huda@svc-alnoor.test";
const NORA = "nora@svc-alnoor.test";
const VIEWER = "viewer@svc-alnoor.test";
const RASHID_ADMIN = "admin@svc-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let alNoor = "";
let sara = "";
let huda = "";
let nora = "";
let viewer = "";
let rashid = "";
let hudaId = "";
let counter = 0;
let rashidWorkflow = "";
let vendor = "";
let complex = "";

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
});

const org = (key: string) => ({ key, scope: "organization" });
const nextName = (prefix: string) => `${prefix} ${++counter}`;

const simpleStages = () => [
  {
    name: "Review",
    assignee: { builtin: "handler" },
    whenUnresolved: "hold",
    handlerMayNarrow: false,
    handlerMayEscalate: false,
    excludeParties: false,
  },
];

async function createWorkflow(name: string, token = huda): Promise<string> {
  const res = await as(token).post("/workflows", { name, stages: simpleStages() });
  expect(res.status).toBe(201);
  return res.body.workflow.id;
}

/** A service allowing the given workflows; the first is the default. */
const servicePayload = (name: string, workflowIds: string[], description?: string) => ({
  name,
  ...(description === undefined ? {} : { description }),
  workflows: workflowIds.map((id, index) => ({ id, isDefault: index === 0 })),
});

async function createService(name: string, workflowIds: string[], token = huda): Promise<string> {
  const res = await as(token).post("/services", servicePayload(name, workflowIds));
  expect(res.status).toBe(201);
  return res.body.service.id;
}

const auditOf = (resourceId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_type, actor_id, details from audit_log where resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

const rowCount = (table: string, tenantId = alNoor) =>
  pool
    .query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenantId])
    .then((result) => result.rows[0].n as number);

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
  const tenant = await seedSubscribedTenant(pool, "svc-al-noor", [
    { email: SARA, userName: "Sara", passwordHash },
    { email: HUDA, userName: "Huda", passwordHash },
    { email: NORA, userName: "Nora", passwordHash },
    { email: VIEWER, userName: "Viewer", passwordHash },
  ]);
  alNoor = tenant.id;
  hudaId = tenant.userIds[1] ?? "";
  const headOfLegal = await seedRole(pool, alNoor, {
    name: "Head of Legal",
    permissions: ["workflow.view", "workflow.manage", "service.view", "service.manage"].map(org),
  });
  const viewerRole = await seedRole(pool, alNoor, {
    name: "Service Viewer",
    permissions: [org("service.view")],
  });
  await pool.query("update tenant_members set role_id = $1 where user_id = $2", [
    headOfLegal,
    hudaId,
  ]);
  await pool.query("update tenant_members set role_id = $1 where user_id = $2", [
    viewerRole,
    tenant.userIds[3],
  ]);

  const rashidTenant = await seedSubscribedTenant(pool, "svc-al-rashid", [
    { email: RASHID_ADMIN, passwordHash },
  ]);
  void rashidTenant;

  sara = (await login(app, SARA, PASSWORD)).access;
  huda = (await login(app, HUDA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
  vendor = await createWorkflow("Vendor contract");
  complex = await createWorkflow("Complex contract");
  rashidWorkflow = await createWorkflow("Their Workflow", rashid);
});

afterAll(async () => {
  await pool.end();
});

describe("creating services (R5.11)", () => {
  it("creates Vendor contract review with two workflows, one the default, and audits it", async () => {
    const res = await as(huda).post("/services", {
      name: "Vendor contract review",
      description: "Review of a contract with a vendor",
      workflows: [
        { id: complex, isDefault: false },
        { id: vendor, isDefault: true },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.service).toEqual({
      id: expect.any(String),
      name: "Vendor contract review",
      description: "Review of a contract with a vendor",
      retired: false,
      form: { revision: 0, fields: [] },
      workflows: [
        { id: complex, name: "Complex contract", isDefault: false, retired: false },
        { id: vendor, name: "Vendor contract", isDefault: true, retired: false },
      ],
    });
    const audit = await auditOf(res.body.service.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "service.created",
      tenant_id: alNoor,
      actor_type: "user",
      actor_id: hudaId,
      details: {
        name: "Vendor contract review",
        description: "Review of a contract with a vendor",
        workflows: [
          { id: complex, isDefault: false },
          { id: vendor, isDefault: true },
        ],
      },
    });
    expect((await as(huda).get(`/services/${res.body.service.id}`)).body.service).toEqual(
      res.body.service,
    );
  });

  it("allows a single workflow, which is then the default, and no description", async () => {
    const res = await as(huda).post("/services", servicePayload(nextName("Single"), [vendor]));
    expect(res.status).toBe(201);
    expect(res.body.service.description).toBeNull();
    expect(res.body.service.workflows).toEqual([
      { id: vendor, name: "Vendor contract", isDefault: true, retired: false },
    ]);
  });

  it("stores a blank description as none, and trims names", async () => {
    const res = await as(huda).post("/services", {
      ...servicePayload(`  ${nextName("Padded")}  `, [vendor]),
      description: "   ",
    });
    expect(res.status).toBe(201);
    expect(res.body.service.description).toBeNull();
    expect(res.body.service.name).toBe(res.body.service.name.trim());
  });

  it("refuses a second name in any case, and leaves nothing behind", async () => {
    const name = nextName("Taken");
    await createService(name, [vendor]);
    const before = await rowCount("service_workflows");
    const res = await as(huda).post(
      "/services",
      servicePayload(name.toUpperCase(), [vendor, complex]),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERVICE_NAME_TAKEN");
    expect(await rowCount("service_workflows")).toBe(before);
  });
});

describe("service validation (R5.11)", () => {
  const post = (body: object) => as(huda).post("/services", body);
  const detailsOf = (res: request.Response) => res.body.error.details;

  it("requires exactly one default", async () => {
    const none = await post({
      name: nextName("NoDefault"),
      workflows: [{ id: vendor, isDefault: false }],
    });
    expect(none.status).toBe(400);
    expect(detailsOf(none)).toEqual([{ path: "workflows", code: "no_default" }]);

    const empty = await post({ name: nextName("Empty"), workflows: [] });
    expect(empty.status).toBe(400);
    expect(detailsOf(empty)).toEqual([{ path: "workflows", code: "no_default" }]);

    const many = await post({
      name: nextName("ManyDefaults"),
      workflows: [
        { id: vendor, isDefault: true },
        { id: complex, isDefault: true },
      ],
    });
    expect(many.status).toBe(400);
    expect(detailsOf(many)).toEqual([{ path: "workflows.1.isDefault", code: "many_defaults" }]);
  });

  it("refuses the same workflow twice", async () => {
    const res = await post({
      name: nextName("Twice"),
      workflows: [
        { id: vendor, isDefault: true },
        { id: vendor, isDefault: false },
      ],
    });
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([{ path: "workflows.1.id", code: "duplicate_workflow" }]);
  });

  it("refuses an unknown workflow and one of another tenant, per entry (R5.19)", async () => {
    const res = await post({
      name: nextName("Unknown"),
      workflows: [
        { id: vendor, isDefault: true },
        { id: rashidWorkflow, isDefault: false },
        { id: "11111111-1111-4111-8111-111111111111", isDefault: false },
      ],
    });
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([
      { path: "workflows.1.id", code: "unknown_workflow" },
      { path: "workflows.2.id", code: "unknown_workflow" },
    ]);
  });

  it("refuses a retired workflow", async () => {
    const retired = await createWorkflow(nextName("Retired Flow"));
    expect((await as(huda).post(`/workflows/${retired}/retire`)).status).toBe(200);
    const res = await post(servicePayload(nextName("UsesRetired"), [vendor, retired]));
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([{ path: "workflows.1.id", code: "workflow_retired" }]);
  });

  it("rejects a malformed or unknown body", async () => {
    const good = servicePayload(nextName("Shape"), [vendor]);
    expect((await post({ ...good, name: "  " })).status).toBe(400);
    expect((await post({ ...good, name: "x".repeat(101) })).status).toBe(400);
    expect((await post({ ...good, description: "x".repeat(2001) })).status).toBe(400);
    expect((await post({ name: good.name })).status).toBe(400);
    expect((await post({ ...good, workflows: [{ id: "nope", isDefault: true }] })).status).toBe(
      400,
    );
    expect((await post({ ...good, workflows: [{ id: vendor }] })).status).toBe(400);
    const unknown = await post({ ...good, retired: true });
    expect(unknown.status).toBe(400);
    expect(detailsOf(unknown)).toEqual([{ path: "retired", code: "unknown_field" }]);
  });
});

describe("reading services", () => {
  it("lists active services by name with their workflows, and hides retired ones unless asked", async () => {
    const a = await createService(nextName("Alpha Listed"), [vendor, complex]);
    const b = await createService(nextName("Beta Listed"), [complex]);
    expect((await as(huda).post(`/services/${b}/retire`)).status).toBe(200);

    const listed = (await as(huda).get("/services")).body.services;
    const names = listed.map((service: { name: string }) => service.name);
    expect(names).toEqual(
      [...names].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())),
    );
    const alpha = listed.find((service: { id: string }) => service.id === a);
    expect(alpha.workflows.map((workflow: { name: string }) => workflow.name)).toEqual([
      "Complex contract",
      "Vendor contract",
    ]);
    expect(listed.some((service: { id: string }) => service.id === b)).toBe(false);

    const all = (await as(huda).get("/services?includeRetired=true")).body.services;
    expect(all.find((service: { id: string }) => service.id === b).retired).toBe(true);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await as(huda).get("/services/11111111-1111-4111-8111-111111111111")).status).toBe(404);
    expect((await as(huda).get("/services/not-a-uuid")).status).toBe(404);
    expect((await as(huda).patch("/services/not-a-uuid", { name: "x" })).status).toBe(404);
    expect((await as(huda).post("/services/not-a-uuid/retire")).status).toBe(404);
  });
});

describe("changing services (R5.11)", () => {
  it("renames and changes the description, auditing before and after", async () => {
    const name = nextName("Change");
    const id = await createService(name, [vendor]);
    const renamed = nextName("Changed");
    const res = await as(huda).patch(`/services/${id}`, {
      name: renamed,
      description: "New text",
    });
    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({ name: renamed, description: "New text" });
    const audit = await auditOf(id);
    expect(audit.map((entry) => entry.action)).toEqual(["service.created", "service.updated"]);
    expect(audit[1]?.details).toEqual({
      before: { name, description: null },
      after: { name: renamed, description: "New text" },
    });

    const cleared = await as(huda).patch(`/services/${id}`, { description: null });
    expect(cleared.body.service.description).toBeNull();
  });

  it("replaces the workflow list and moves the default", async () => {
    const id = await createService(nextName("Replace"), [vendor, complex]);
    const res = await as(huda).patch(`/services/${id}`, {
      workflows: [
        { id: vendor, isDefault: false },
        { id: complex, isDefault: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(
      res.body.service.workflows.map((w: { name: string; isDefault: boolean }) => [
        w.name,
        w.isDefault,
      ]),
    ).toEqual([
      ["Complex contract", true],
      ["Vendor contract", false],
    ]);

    const fewer = await as(huda).patch(`/services/${id}`, {
      workflows: [{ id: complex, isDefault: true }],
    });
    expect(fewer.body.service.workflows).toHaveLength(1);
    const audit = await auditOf(id);
    expect(audit.at(-1)?.details).toEqual({
      before: {
        workflows: [
          { id: complex, isDefault: true },
          { id: vendor, isDefault: false },
        ],
      },
      after: { workflows: [{ id: complex, isDefault: true }] },
    });
  });

  it("changes nothing and audits nothing when the save equals the current service", async () => {
    const name = nextName("Same");
    const id = await createService(name, [vendor, complex]);
    const res = await as(huda).patch(`/services/${id}`, {
      name,
      workflows: [
        { id: complex, isDefault: false },
        { id: vendor, isDefault: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.service.name).toBe(name);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("validates a replaced workflow list like a new one", async () => {
    const id = await createService(nextName("Validate"), [vendor]);
    const none = await as(huda).patch(`/services/${id}`, { workflows: [] });
    expect(none.status).toBe(400);
    expect(none.body.error.details).toEqual([{ path: "workflows", code: "no_default" }]);
    const foreign = await as(huda).patch(`/services/${id}`, {
      workflows: [{ id: rashidWorkflow, isDefault: true }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details).toEqual([
      { path: "workflows.0.id", code: "unknown_workflow" },
    ]);
    const empty = await as(huda).patch(`/services/${id}`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details).toEqual([{ path: "", code: "no_fields" }]);
    expect((await as(huda).get(`/services/${id}`)).body.service.workflows).toHaveLength(1);
  });

  it("refuses a name taken by another service, and allows changing only the case", async () => {
    const name = nextName("Case");
    const id = await createService(name, [vendor]);
    const other = nextName("Other");
    await createService(other, [vendor]);
    const taken = await as(huda).patch(`/services/${id}`, { name: other.toLowerCase() });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("SERVICE_NAME_TAKEN");
    const recased = await as(huda).patch(`/services/${id}`, { name: name.toUpperCase() });
    expect(recased.status).toBe(200);
    expect(recased.body.service.name).toBe(name.toUpperCase());
  });

  it("refuses a retired service", async () => {
    const id = await createService(nextName("Gone"), [vendor]);
    await as(huda).post(`/services/${id}/retire`);
    const res = await as(huda).patch(`/services/${id}`, { description: "late" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_RETIRED");
  });
});

describe("retiring and restoring (R5.15)", () => {
  it("retires and restores, audited, and repeating either changes nothing", async () => {
    const id = await createService(nextName("Cycle"), [vendor]);
    const retired = await as(huda).post(`/services/${id}/retire`);
    expect(retired.status).toBe(200);
    expect(retired.body.service.retired).toBe(true);
    expect((await as(huda).post(`/services/${id}/retire`)).status).toBe(200);
    // A retired service can be read.
    expect((await as(huda).get(`/services/${id}`)).body.service.retired).toBe(true);

    const restored = await as(huda).post(`/services/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.service.retired).toBe(false);
    expect((await as(huda).post(`/services/${id}/restore`)).status).toBe(200);

    expect((await auditOf(id)).map((entry) => entry.action)).toEqual([
      "service.created",
      "service.retired",
      "service.restored",
    ]);
  });

  it("frees the name on retire, and refuses to restore it once the name is reused", async () => {
    const name = nextName("Reused");
    const id = await createService(name, [vendor]);
    await as(huda).post(`/services/${id}/retire`);
    await createService(name, [vendor]);
    const res = await as(huda).post(`/services/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERVICE_NAME_TAKEN");
  });

  it("refuses to restore a service while an allowed workflow is retired", async () => {
    const flow = await createWorkflow(nextName("Short Lived"));
    const id = await createService(nextName("Needs Flow"), [vendor, flow]);
    await as(huda).post(`/services/${id}/retire`);
    expect((await as(huda).post(`/workflows/${flow}/retire`)).status).toBe(200);

    const refused = await as(huda).post(`/services/${id}/restore`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("SERVICE_WORKFLOW_RETIRED");
    expect(refused.body.error.details).toEqual([
      { path: expect.stringMatching(/^workflows\.\d\.id$/), code: "workflow_retired" },
    ]);
    expect((await as(huda).get(`/services/${id}`)).body.service.retired).toBe(true);

    expect((await as(huda).post(`/workflows/${flow}/restore`)).status).toBe(200);
    expect((await as(huda).post(`/services/${id}/restore`)).status).toBe(200);
  });

  it("answers 404 for an unknown service", async () => {
    const unknown = "11111111-1111-4111-8111-111111111111";
    expect((await as(huda).post(`/services/${unknown}/retire`)).status).toBe(404);
    expect((await as(huda).post(`/services/${unknown}/restore`)).status).toBe(404);
  });
});

describe("a workflow in use cannot be retired (R5.16)", () => {
  it("refuses retiring a workflow an active service allows, and retiring the service frees it", async () => {
    const flow = await createWorkflow(nextName("Busy"));
    const service = await createService(nextName("Uses Busy"), [vendor, flow]);

    const refused = await as(huda).post(`/workflows/${flow}/retire`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("WORKFLOW_IN_USE");
    expect((await as(huda).get(`/workflows/${flow}`)).body.workflow.retired).toBe(false);

    await as(huda).post(`/services/${service}/retire`);
    expect((await as(huda).post(`/workflows/${flow}/retire`)).status).toBe(200);
  });

  it("refuses even when the workflow is a non-default one of a service", async () => {
    const flow = await createWorkflow(nextName("Second Choice"));
    await createService(nextName("Two Choices"), [vendor, flow]);
    const res = await as(huda).post(`/workflows/${flow}/retire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKFLOW_IN_USE");
  });

  it("allows it once a service stops allowing the workflow", async () => {
    const flow = await createWorkflow(nextName("Dropped"));
    const service = await createService(nextName("Drops"), [vendor, flow]);
    expect((await as(huda).post(`/workflows/${flow}/retire`)).status).toBe(409);
    await as(huda).patch(`/services/${service}`, { workflows: [{ id: vendor, isDefault: true }] });
    expect((await as(huda).post(`/workflows/${flow}/retire`)).status).toBe(200);
  });

  it("does not count a service of another tenant", async () => {
    const flow = await createWorkflow(nextName("Mine Alone"));
    const theirs = await createWorkflow(nextName("Theirs"), rashid);
    await createService(nextName("Their Service"), [theirs], rashid);
    expect((await as(huda).post(`/workflows/${flow}/retire`)).status).toBe(200);
    expect((await as(rashid).post(`/workflows/${theirs}/retire`)).status).toBe(409);
  });
});

describe("the database guards services (R5.11, R5.19)", () => {
  it("refuses a second default for one service", async () => {
    const id = await createService(nextName("Guard Default"), [vendor]);
    const err = await rejectionText(
      pool.query(
        "insert into service_workflows (tenant_id, service_id, workflow_id, is_default) values ($1, $2, $3, true)",
        [alNoor, id, complex],
      ),
    );
    expect(err).toContain("service_workflows_one_default");
  });

  it("refuses a workflow of another tenant", async () => {
    const id = await createService(nextName("Guard Tenant"), [vendor]);
    const err = await rejectionText(
      pool.query(
        "insert into service_workflows (tenant_id, service_id, workflow_id, is_default) values ($1, $2, $3, false)",
        [alNoor, id, rashidWorkflow],
      ),
    );
    expect(err).toContain("service_workflows_workflow_fk");
  });

  it("refuses an over-long description and a padded name", async () => {
    expect(
      await rejectionText(
        pool.query("insert into services (tenant_id, name, description) values ($1, 'D', $2)", [
          alNoor,
          "x".repeat(2001),
        ]),
      ),
    ).toContain("services_description_length");
    expect(
      await rejectionText(
        pool.query("insert into services (tenant_id, name) values ($1, ' padded ')", [alNoor]),
      ),
    ).toContain("services_name_length");
  });
});

describe("races (section 5)", () => {
  it("refuses a service save naming a workflow whose retire is in flight", async () => {
    const flow = await createWorkflow(nextName("Race Retire Flow"));
    const name = nextName("Race Save Service");

    let saving: Promise<request.Response> = Promise.reject(new Error("not started"));
    saving.catch(() => undefined);
    await whileHolding(
      "select id from workflows where id = $1 for update",
      [flow],
      async (client) => {
        saving = as(huda)
          .post("/services", servicePayload(name, [vendor, flow]))
          .then((res) => res);
        await waitUntilBlockedOn(pool, "workflows");
        await client.query("update workflows set retired_at = now() where id = $1", [flow]);
      },
    );
    const res = await saving;

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "workflows.1.id", code: "workflow_retired" }]);
    expect(
      (
        await pool.query("select 1 from services where tenant_id = $1 and name = $2", [
          alNoor,
          name,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("refuses an update naming a workflow whose retire is in flight", async () => {
    const flow = await createWorkflow(nextName("Race Update Flow"));
    const id = await createService(nextName("Race Update Service"), [vendor]);

    let saving: Promise<request.Response> = Promise.reject(new Error("not started"));
    saving.catch(() => undefined);
    await whileHolding(
      "select id from workflows where id = $1 for update",
      [flow],
      async (client) => {
        saving = as(huda)
          .patch(`/services/${id}`, {
            workflows: [
              { id: vendor, isDefault: true },
              { id: flow, isDefault: false },
            ],
          })
          .then((res) => res);
        await waitUntilBlockedOn(pool, "workflows");
        await client.query("update workflows set retired_at = now() where id = $1", [flow]);
      },
    );
    const res = await saving;

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "workflows.1.id", code: "workflow_retired" }]);
    expect((await as(huda).get(`/services/${id}`)).body.service.workflows).toHaveLength(1);
  });

  it("refuses retiring a workflow whose service save is in flight", async () => {
    const flow = await createWorkflow(nextName("Race Save Flow"));

    let retiring: Promise<request.Response> = Promise.reject(new Error("not started"));
    retiring.catch(() => undefined);
    // A save in flight: it holds the share lock and has written the service that allows the workflow.
    await whileHolding(
      "select id from workflows where id = $1 for share",
      [flow],
      async (client) => {
        retiring = as(huda)
          .post(`/workflows/${flow}/retire`)
          .then((res) => res);
        await waitUntilBlockedOn(pool, "workflows");
        const { rows } = await client.query(
          "insert into services (tenant_id, name) values ($1, $2) returning id",
          [alNoor, nextName("Racing Service")],
        );
        await client.query(
          "insert into service_workflows (tenant_id, service_id, workflow_id, is_default) values ($1, $2, $3, true)",
          [alNoor, rows[0].id, flow],
        );
      },
    );
    const res = await retiring;

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKFLOW_IN_USE");
    expect((await as(huda).get(`/workflows/${flow}`)).body.workflow.retired).toBe(false);
  });

  it("refuses restoring a service whose workflow retire is in flight", async () => {
    const flow = await createWorkflow(nextName("Race Restore Flow"));
    const id = await createService(nextName("Race Restore Service"), [vendor, flow]);
    await as(huda).post(`/services/${id}/retire`);

    let restoring: Promise<request.Response> = Promise.reject(new Error("not started"));
    restoring.catch(() => undefined);
    await whileHolding(
      "select id from workflows where id = $1 for update",
      [flow],
      async (client) => {
        restoring = as(huda)
          .post(`/services/${id}/restore`)
          .then((res) => res);
        await waitUntilBlockedOn(pool, "workflows");
        await client.query("update workflows set retired_at = now() where id = $1", [flow]);
      },
    );
    const res = await restoring;

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERVICE_WORKFLOW_RETIRED");
  });

  it("waits for the service row lock before a change", async () => {
    const name = nextName("Race Rename");
    const id = await createService(name, [vendor]);
    let renaming: Promise<request.Response> = Promise.reject(new Error("not started"));
    renaming.catch(() => undefined);
    await whileHolding("select id from services where id = $1 for update", [id], async () => {
      renaming = as(huda)
        .patch(`/services/${id}`, { description: "second" })
        .then((res) => res);
      await waitUntilBlockedOn(pool, "services");
    });
    expect((await renaming).status).toBe(200);
  });
});

describe("authorization (R5.17)", () => {
  it("refuses a member with no service permissions", async () => {
    const id = await createService(nextName("Guarded"), [vendor]);
    for (const res of [
      await as(nora).get("/services"),
      await as(nora).get(`/services/${id}`),
      await as(nora).post("/services", servicePayload("X", [vendor])),
      await as(nora).patch(`/services/${id}`, { name: "X" }),
      await as(nora).post(`/services/${id}/retire`),
      await as(nora).post(`/services/${id}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("lets service.view read but not change", async () => {
    const id = await createService(nextName("Viewable"), [vendor]);
    expect((await as(viewer).get("/services")).status).toBe(200);
    expect((await as(viewer).get(`/services/${id}`)).status).toBe(200);
    expect((await as(viewer).post("/services", servicePayload("Y", [vendor]))).status).toBe(403);
    expect((await as(viewer).patch(`/services/${id}`, { name: "Y" })).status).toBe(403);
    expect((await as(viewer).post(`/services/${id}/retire`)).status).toBe(403);
    expect((await as(viewer).post(`/services/${id}/restore`)).status).toBe(403);
  });

  it("lets the Tenant Admin manage without any role change", async () => {
    const res = await as(sara).post(
      "/services",
      servicePayload(nextName("Admin Service"), [vendor]),
    );
    expect(res.status).toBe(201);
  });

  it("requires a signed-in user", async () => {
    expect((await request(app).get("/services")).status).toBe(401);
  });
});

describe("Read-only subscriptions (R5.18)", () => {
  it("refuses changes and still shows services", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "svc-read-only", [
      { email: "admin@svc-read-only.test", passwordHash },
    ]);
    const admin = (await login(app, "admin@svc-read-only.test", PASSWORD)).access;
    const flow = await createWorkflow("Before Expiry", admin);
    const id = await createService("Before Expiry", [flow], admin);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    for (const res of [
      await as(admin).post("/services", servicePayload("Late", [flow])),
      await as(admin).patch(`/services/${id}`, { name: "Late" }),
      await as(admin).post(`/services/${id}/retire`),
      await as(admin).post(`/services/${id}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    }
    expect((await as(admin).get("/services")).status).toBe(200);
    expect((await as(admin).get(`/services/${id}`)).status).toBe(200);
  });
});

describe("tenant isolation (R5.19)", () => {
  it("shows each tenant only its own services, and answers 404 across tenants", async () => {
    const mine = await createService(nextName("Al-Noor Only"), [vendor]);
    const theirsRes = await as(rashid).post(
      "/services",
      servicePayload(nextName("Al-Rashid Only"), [rashidWorkflow]),
    );
    expect(theirsRes.status).toBe(201);
    const theirs = theirsRes.body.service.id;

    const idsOf = async (token: string) =>
      (await as(token).get("/services")).body.services.map((s: { id: string }) => s.id);
    expect(await idsOf(huda)).toContain(mine);
    expect(await idsOf(huda)).not.toContain(theirs);
    expect(await idsOf(rashid)).toContain(theirs);
    expect(await idsOf(rashid)).not.toContain(mine);

    expect((await as(huda).get(`/services/${theirs}`)).status).toBe(404);
    expect((await as(huda).patch(`/services/${theirs}`, { name: "Hijack" })).status).toBe(404);
    expect((await as(huda).post(`/services/${theirs}/retire`)).status).toBe(404);
    expect((await as(huda).post(`/services/${theirs}/restore`)).status).toBe(404);
  });

  it("lets two tenants use the same service name", async () => {
    const name = nextName("Shared Name");
    await createService(name, [vendor]);
    const res = await as(rashid).post("/services", servicePayload(name, [rashidWorkflow]));
    expect(res.status).toBe(201);
  });
});
