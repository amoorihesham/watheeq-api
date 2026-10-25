import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  connectToTestDb,
  seedRole,
  seedSubscribedTenant,
  waitUntilBlockedOn,
} from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const HUDA = "huda@form-alnoor.test";
const NORA = "nora@form-alnoor.test";
const VIEWER = "viewer@form-alnoor.test";
const RASHID_ADMIN = "admin@form-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let alNoor = "";
let huda = "";
let nora = "";
let viewer = "";
let rashid = "";
let hudaId = "";
let counter = 0;
let workflow = "";
let rashidWorkflow = "";

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
});

const org = (key: string) => ({ key, scope: "organization" });

async function createService(token = huda, workflowId = workflow): Promise<string> {
  const res = await as(token).post("/services", {
    name: `Form Service ${++counter}`,
    workflows: [{ id: workflowId, isDefault: true }],
  });
  expect(res.status).toBe(201);
  return res.body.service.id;
}

const saveForm = (id: string, baseRevision: number, fields: object[], token = huda) =>
  as(token).put(`/services/${id}/form`, { baseRevision, fields });

const detailsOf = (res: request.Response) => res.body.error.details;

const auditOf = (resourceId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_id, details from audit_log where resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

/** Huda's form for "Vendor contract review" (Phase 5.5 spec, section 3). */
const vendorForm = () => [
  { type: "short_text", label: "Counterparty name", helpText: null, required: true },
  {
    type: "number",
    label: "Contract value (SAR)",
    helpText: "Total over the term",
    required: true,
    min: 0,
    max: null,
    integer: false,
  },
  {
    type: "single_choice",
    label: "Contract type",
    helpText: null,
    required: true,
    options: [{ label: "Supply" }, { label: "Services" }, { label: "Lease" }],
  },
  { type: "date", label: "Expected start date", helpText: null, required: false },
  { type: "yes_no", label: "Needs Arabic translation", helpText: null, required: false },
  { type: "file", label: "Draft contract", helpText: null, required: true, maxFiles: 3 },
  { type: "long_text", label: "Notes", helpText: null, required: false },
];

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, "form-al-noor", [
    { email: "sara@form-alnoor.test", userName: "Sara", passwordHash },
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
  await seedSubscribedTenant(pool, "form-al-rashid", [{ email: RASHID_ADMIN, passwordHash }]);

  huda = (await login(app, HUDA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
  const stages = [
    {
      name: "Review",
      assignee: { builtin: "handler" },
      whenUnresolved: "hold",
      handlerMayNarrow: false,
      handlerMayEscalate: false,
      excludeParties: false,
    },
  ];
  workflow = (await as(huda).post("/workflows", { name: "Form flow", stages })).body.workflow.id;
  rashidWorkflow = (await as(rashid).post("/workflows", { name: "Their flow", stages })).body
    .workflow.id;
});

afterAll(async () => {
  await pool.end();
});

describe("saving a form (R5.5.1-R5.5.4)", () => {
  it("starts empty at revision 0, and saves Huda's form as written, with new IDs, audited", async () => {
    const id = await createService();
    const fresh = await as(huda).get(`/services/${id}`);
    expect(fresh.body.service.form).toEqual({ revision: 0, fields: [] });

    const res = await saveForm(id, 0, vendorForm());
    expect(res.status).toBe(200);
    const { revision, fields } = res.body.service.form;
    expect(revision).toBe(1);
    expect(fields.map((field: { label: string }) => field.label)).toEqual([
      "Counterparty name",
      "Contract value (SAR)",
      "Contract type",
      "Expected start date",
      "Needs Arabic translation",
      "Draft contract",
      "Notes",
    ]);
    expect(new Set(fields.map((field: { id: string }) => field.id)).size).toBe(7);
    expect(fields[1]).toMatchObject({
      type: "number",
      helpText: "Total over the term",
      min: 0,
      max: null,
      integer: false,
    });
    expect(fields[2].options.map((option: { label: string }) => option.label)).toEqual([
      "Supply",
      "Services",
      "Lease",
    ]);
    expect(fields[2].options.every((option: { id: string }) => option.id.length === 36)).toBe(true);
    expect(fields[5]).toMatchObject({ type: "file", maxFiles: 3 });
    expect((await as(huda).get(`/services/${id}`)).body.service.form).toEqual(
      res.body.service.form,
    );

    const audit = (await auditOf(id)).filter((row) => row.action === "service.form_updated");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenant_id: alNoor,
      actor_id: hudaId,
      details: { revision: 1, before: [], after: fields },
    });
  });

  it("keeps IDs across saves, and a no-op save returns 200 without a revision or audit entry", async () => {
    const id = await createService();
    const first = (await saveForm(id, 0, vendorForm())).body.service.form;

    const same = await saveForm(id, 1, first.fields);
    expect(same.status).toBe(200);
    expect(same.body.service.form).toEqual(first);
    expect((await auditOf(id)).filter((row) => row.action === "service.form_updated")).toHaveLength(
      1,
    );

    const reordered = [...first.fields].reverse();
    const second = await saveForm(id, 1, reordered);
    expect(second.body.service.form.revision).toBe(2);
    expect(second.body.service.form.fields.map((field: { id: string }) => field.id)).toEqual(
      reordered.map((field: { id: string }) => field.id),
    );
  });

  it("keeps field and option IDs on edit, gives new ones to new entries, and allows removing a field", async () => {
    const id = await createService();
    const first = (await saveForm(id, 0, vendorForm())).body.service.form.fields;
    const [name, , type] = first;
    const edited = [
      { ...name, label: "Vendor name" },
      {
        ...type,
        label: "Agreement type",
        options: [type.options[0], { label: "Licence" }, type.options[2]],
      },
    ];
    const res = await saveForm(id, 1, edited);

    expect(res.status).toBe(200);
    const fields = res.body.service.form.fields;
    expect(fields[0]).toMatchObject({ id: name.id, label: "Vendor name" });
    expect(fields[1].id).toBe(type.id);
    expect(fields[1].options[0]).toEqual(type.options[0]);
    expect(fields[1].options[2]).toEqual(type.options[2]);
    expect(fields[1].options[1].label).toBe("Licence");
    expect([type.options[0].id, type.options[1].id, type.options[2].id]).not.toContain(
      fields[1].options[1].id,
    );
    expect(fields).toHaveLength(2);
    const audit = (await auditOf(id)).filter((row) => row.action === "service.form_updated");
    expect(audit[1]?.details).toMatchObject({ revision: 2, before: first, after: fields });
  });

  it("refuses a save based on an older revision", async () => {
    const id = await createService();
    expect((await saveForm(id, 0, vendorForm())).status).toBe(200);
    const stale = await saveForm(id, 0, []);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("SERVICE_FORM_CHANGED");
    expect((await as(huda).get(`/services/${id}`)).body.service.form.fields).toHaveLength(7);
    const ahead = await saveForm(id, 5, []);
    expect(ahead.body.error.code).toBe("SERVICE_FORM_CHANGED");
  });

  it("refuses a retired service", async () => {
    const id = await createService();
    await as(huda).post(`/services/${id}/retire`);
    const res = await saveForm(id, 0, vendorForm());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_RETIRED");
  });

  it("answers 404 for an unknown or malformed service", async () => {
    expect((await saveForm("00000000-0000-4000-8000-000000000000", 0, [])).status).toBe(404);
    expect((await saveForm("nope", 0, [])).status).toBe(404);
  });
});

describe("form validation (R5.5.2, R5.5.3, R5.5.5)", () => {
  const short = (label: string, extra: object = {}) => ({
    type: "short_text",
    label,
    helpText: null,
    required: false,
    ...extra,
  });
  const choice = (options: object[], type = "single_choice") => ({
    type,
    label: "Pick",
    helpText: null,
    required: false,
    options,
  });
  let id = "";

  beforeEach(async () => {
    id = await createService();
  });

  it("refuses a label repeated in any case, at the later field", async () => {
    const res = await saveForm(id, 0, [short("Notes"), short("Other"), short("  notes ")]);
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([{ path: "fields.2.label", code: "duplicate_label" }]);
  });

  it("refuses a repeated option label in any case, and a repeated option ID", async () => {
    const res = await saveForm(id, 0, [
      choice([{ label: "Supply" }, { label: "Services" }, { label: "Lease" }, { label: "supply" }]),
    ]);
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([
      { path: "fields.0.options.3.label", code: "duplicate_option" },
    ]);

    const first = (await saveForm(id, 0, [choice([{ label: "A" }, { label: "B" }])])).body.service
      .form;
    const optionId = first.fields[0].options[0].id;
    const repeated = await saveForm(id, first.revision, [
      {
        ...first.fields[0],
        options: [
          { id: optionId, label: "A" },
          { id: optionId, label: "C" },
        ],
      },
    ]);
    expect(detailsOf(repeated)).toEqual([
      { path: "fields.0.options.1.id", code: "duplicate_option" },
    ]);
  });

  it("refuses a field ID used twice", async () => {
    const first = (await saveForm(id, 0, [short("A")])).body.service.form;
    const field = first.fields[0];
    const res = await saveForm(id, first.revision, [field, { ...field, label: "B" }]);
    expect(detailsOf(res)).toEqual([{ path: "fields.1.id", code: "duplicate_field_id" }]);
  });

  it("refuses a minimum above the maximum", async () => {
    const res = await saveForm(id, 0, [
      {
        type: "number",
        label: "Value",
        helpText: null,
        required: false,
        min: 100,
        max: 10,
        integer: false,
      },
    ]);
    expect(detailsOf(res)).toEqual([{ path: "fields.0.min", code: "min_above_max" }]);
  });

  it("refuses an ID that is not in this service's form, for fields and options", async () => {
    const other = await createService();
    const theirs = (await saveForm(other, 0, [choice([{ label: "A" }])])).body.service.form;
    const foreign = await saveForm(id, 0, [{ ...theirs.fields[0] }]);
    expect(foreign.status).toBe(400);
    expect(detailsOf(foreign)).toEqual([{ path: "fields.0.id", code: "unknown_field_id" }]);

    const mine = (await saveForm(id, 0, [choice([{ label: "A" }])])).body.service.form;
    const badOption = await saveForm(id, mine.revision, [
      {
        ...mine.fields[0],
        options: [{ id: theirs.fields[0].options[0].id, label: "A" }, { label: "B" }],
      },
    ]);
    expect(detailsOf(badOption)).toEqual([
      { path: "fields.0.options.0.id", code: "unknown_option_id" },
    ]);
    const onNewField = await saveForm(id, mine.revision, [
      { ...choice([{ id: mine.fields[0].options[0].id, label: "A" }]) },
    ]);
    expect(detailsOf(onNewField)).toEqual([
      { path: "fields.0.options.0.id", code: "unknown_option_id" },
    ]);
  });

  it("refuses a different type for an existing field", async () => {
    const first = (
      await saveForm(id, 0, [
        { type: "date", label: "Expected start date", helpText: null, required: false },
      ])
    ).body.service.form;
    const res = await saveForm(id, first.revision, [
      { ...short("Expected start date"), id: first.fields[0].id },
    ]);
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([{ path: "fields.0.type", code: "type_changed" }]);
  });

  it("rejects malformed fields and settings that do not belong to the type (T25)", async () => {
    const bad = async (fields: object[]) => (await saveForm(id, 0, fields)).status;
    expect(await bad([short("")])).toBe(400);
    expect(await bad([short("x".repeat(201))])).toBe(400);
    expect(await bad([short("A", { helpText: "x".repeat(501) })])).toBe(400);
    expect(await bad([short("A", { required: "yes" })])).toBe(400);
    expect(await bad([short("A", { type: "rich_text" })])).toBe(400);
    expect(await bad([choice([])])).toBe(400);
    expect(await bad([choice(Array.from({ length: 51 }, (_, i) => ({ label: `O${i}` })))])).toBe(
      400,
    );
    expect(await bad([choice([{ label: "x".repeat(201) }])])).toBe(400);
    expect(
      await bad([{ type: "file", label: "F", helpText: null, required: false, maxFiles: 0 }]),
    ).toBe(400);
    expect(
      await bad([{ type: "file", label: "F", helpText: null, required: false, maxFiles: 11 }]),
    ).toBe(400);
    expect(await bad([{ type: "file", label: "F", helpText: null, required: false }])).toBe(400);
    expect(
      await bad([{ type: "number", label: "N", helpText: null, required: false, min: 1 }]),
    ).toBe(400);
    const stray = await saveForm(id, 0, [short("A", { min: 1 })]);
    expect(detailsOf(stray)).toEqual([{ path: "fields.0.min", code: "unknown_field" }]);
    const strayBody = await as(huda).put(`/services/${id}/form`, {
      baseRevision: 0,
      fields: [],
      extra: 1,
    });
    expect(detailsOf(strayBody)).toEqual([{ path: "extra", code: "unknown_field" }]);
    expect((await as(huda).put(`/services/${id}/form`, { fields: [] })).status).toBe(400);
  });

  it("accepts the limits themselves, any number of fields, and a blank help text as none", async () => {
    const fields = [
      short("x".repeat(200), { helpText: "y".repeat(500) }),
      choice(Array.from({ length: 50 }, (_, i) => ({ label: `Option ${i}` }))),
      { type: "file", label: "F", helpText: "", required: true, maxFiles: 10 },
      ...Array.from({ length: 150 }, (_, i) => short(`Field ${i}`)),
    ];
    const res = await saveForm(id, 0, fields);
    expect(res.status).toBe(200);
    expect(res.body.service.form.fields).toHaveLength(153);
    expect(res.body.service.form.fields[2].helpText).toBeNull();
    expect((await saveForm(id, 1, [])).body.service.form).toEqual({ revision: 2, fields: [] });
  });
});

describe("race (section 5)", () => {
  it("waits for the service row lock, then judges the revision it finds", async () => {
    const id = await createService();
    const client = await pool.connect();
    let saving: Promise<request.Response> = Promise.reject(new Error("not started"));
    saving.catch(() => undefined);
    try {
      await client.query("begin");
      await client.query("select id from services where id = $1 for update", [id]);
      saving = saveForm(id, 0, vendorForm()).then((res) => res);
      await waitUntilBlockedOn(pool, "services");
      await client.query("update services set form_revision = 5 where id = $1", [id]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    const res = await saving;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERVICE_FORM_CHANGED");
  });

  it("lets only one of two saves from the same revision win", async () => {
    const id = await createService();
    const results = await Promise.all([
      saveForm(id, 0, vendorForm()),
      saveForm(id, 0, vendorForm().slice(0, 2)),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const form = (await as(huda).get(`/services/${id}`)).body.service.form;
    expect(form.revision).toBe(1);
  });
});

describe("authorization, subscription, tenants (R5.5.14, R5.5.16)", () => {
  it("requires service.manage; service.view only reads the form", async () => {
    const id = await createService();
    expect((await saveForm(id, 0, [], nora)).status).toBe(403);
    expect((await saveForm(id, 0, [], viewer)).status).toBe(403);
    expect((await as(viewer).get(`/services/${id}`)).body.service.form).toEqual({
      revision: 0,
      fields: [],
    });
    expect((await request(app).put(`/services/${id}/form`).send({})).status).toBe(401);
  });

  it("includes the form in the service list", async () => {
    const id = await createService();
    await saveForm(id, 0, vendorForm());
    const list = await as(huda).get("/services");
    const found = list.body.services.find((service: { id: string }) => service.id === id);
    expect(found.form.revision).toBe(1);
  });

  it("refuses saves while the subscription is Read-only", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "form-read-only", [
      { email: "admin@form-read-only.test", passwordHash },
    ]);
    const admin = (await login(app, "admin@form-read-only.test", PASSWORD)).access;
    const flow = (
      await as(admin).post("/workflows", {
        name: "Flow",
        stages: [
          {
            name: "Review",
            assignee: { builtin: "handler" },
            whenUnresolved: "hold",
            handlerMayNarrow: false,
            handlerMayEscalate: false,
            excludeParties: false,
          },
        ],
      })
    ).body.workflow.id;
    const id = await createService(admin, flow);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const res = await saveForm(id, 0, vendorForm(), admin);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    expect((await as(admin).get(`/services/${id}`)).body.service.form.revision).toBe(0);
  });

  it("answers 404 across tenants and leaves the other tenant's form alone", async () => {
    const id = await createService();
    const theirs = await createService(rashid, rashidWorkflow);
    expect((await saveForm(id, 0, vendorForm(), rashid)).status).toBe(404);
    expect((await saveForm(theirs, 0, vendorForm(), huda)).status).toBe(404);
    expect((await as(huda).get(`/services/${id}`)).body.service.form.revision).toBe(0);
    expect((await as(rashid).get(`/services/${theirs}`)).body.service.form.revision).toBe(0);
  });
});

describe("the database guards the form (R5.5.1)", () => {
  it("defaults to an empty array at revision 0 and refuses a form that is not an array", async () => {
    const id = await createService();
    const { rows } = await pool.query("select form, form_revision from services where id = $1", [
      id,
    ]);
    expect(rows[0]).toEqual({ form: [], form_revision: 0 });
    await expect(
      pool.query(`update services set form = '{"a": 1}'::jsonb where id = $1`, [id]),
    ).rejects.toThrow(/services_form_is_array/);
  });
});
