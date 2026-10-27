import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { withTx } from "../src/db/tx.js";
import { createLogger } from "../src/logging/logger.js";
import { fromRiyadh, toRiyadh } from "../src/modules/calendar/index.js";
import { nextNumber } from "../src/modules/requests/index.js";
import {
  type AlNoorType,
  asUser,
  type PersonType,
  seedAlNoor,
  vendorAnswers,
} from "./helpers/al-noor.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  connectToTestDb,
  seedRole,
  seedSubscribedTenant,
  seedTenant,
  seedUser,
  waitUntilBlockedOn,
} from "./helpers/db.js";

// Phase 6 spec, steps 6.1: numbers, submission, visibility, review, accept, reject, withdraw, the SLA deadline.

const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger("silent"));

let alNoor: AlNoorType;
let rashid: { tenantId: string; admin: string; userId: string };

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);

const draft = (overrides: object = {}) => ({
  serviceId: alNoor.serviceId,
  priorityId: alNoor.priorities.high,
  title: "Gulf Supplies contract",
  answers: vendorAnswers(alNoor),
  ...overrides,
});

async function submit(person: PersonType, overrides: object = {}) {
  const res = await as(person).post("/requests", draft(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; number: string; state: string };
}

async function accept(id: string, handler: PersonType = "faisal", reviewer: PersonType = "huda") {
  const res = await as(reviewer).post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids[handler],
    workflowId: alNoor.workflows.vendor,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

const rowOf = (id: string) =>
  pool.query("select * from requests where id = $1", [id]).then((result) => result.rows[0]);

const auditOf = (id: string) =>
  pool
    .query(
      "select action, actor_id, reason, details from audit_log where resource_id = $1 order by id",
      [id],
    )
    .then((result) => result.rows);

const riyadhYear = async () =>
  (
    await pool.query<{ year: number }>(
      "select extract(year from now() at time zone 'Asia/Riyadh')::int as year",
    )
  ).rows[0]?.year;

const setSubscriptionEnd = (daysFromToday: number) =>
  pool.query(
    `update subscriptions set start_date = (now() at time zone 'Asia/Riyadh')::date - 400,
       end_date = (now() at time zone 'Asia/Riyadh')::date + $2::int where tenant_id = $1`,
    [alNoor.tenantId, daysFromToday],
  );

const codeOf = (res: { body: { error: { code: string } } }) => res.body.error.code;
const detailsOf = (res: { body: { error: { details: unknown } } }) => res.body.error.details;

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, "req-al-noor");
  const passwordHash = await hashPassword("correct horse battery staple");
  const tenant = await seedSubscribedTenant(pool, "req-al-rashid", [
    { email: "admin@req-alrashid.test", passwordHash },
    { email: "worker@req-alrashid.test", passwordHash },
  ]);
  await pool.query(
    `insert into escalation_settings (tenant_id, r0_enabled, r0_days, r1_enabled, r1_percent, r2_enabled)
     values ($1, false, 2, false, 75, false)`,
    [tenant.id],
  );
  rashid = {
    tenantId: tenant.id,
    admin: (await login(app, "admin@req-alrashid.test", "correct horse battery staple")).access,
    userId: tenant.userIds[1] ?? "",
  };
});

afterAll(async () => {
  await pool.end();
});

describe("request numbers (R6.1)", () => {
  it("numbers a tenant's requests from 1 in the Riyadh year, with no padding", async () => {
    const first = await submit("khalid");
    const second = await submit("lina");
    const year = await riyadhYear();
    const [a, b] = [first, second].map((r) => Number(r.number.split("-")[1]));
    expect(first.number).toMatch(new RegExp(`^REQ-\\d+-${year}$`));
    expect(b).toBe((a ?? 0) + 1);
  });

  it("gives concurrent submissions consecutive numbers", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => submit("khalid")));
    const numbers = results.map((r) => Number(r.number.split("-")[1])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, i) => (numbers[0] ?? 0) + i));
  });

  it("counts a year from the Riyadh clock and restarts each year", async () => {
    const { id } = await seedTenant(pool, "req-numbers", [{ email: "owner@req-numbers.test" }]);
    const at = (iso: string) => withTx(db, (tx) => nextNumber(tx, id, "REQ", new Date(iso)));
    // 2031-12-31 20:59:59 UTC is 23:59:59 in Riyadh; one second later it is the new year there.
    expect(await at("2031-12-31T20:59:58Z")).toEqual({ year: 2031, number: 1 });
    expect(await at("2031-12-31T20:59:59Z")).toEqual({ year: 2031, number: 2 });
    expect(await at("2031-12-31T21:00:00Z")).toEqual({ year: 2032, number: 1 });
    expect(await at("2032-01-01T00:00:00Z")).toEqual({ year: 2032, number: 2 });
  });

  it("leaves no gap when a transaction rolls back", async () => {
    const { id } = await seedTenant(pool, "req-gaps", [{ email: "owner@req-gaps.test" }]);
    const at = new Date("2033-06-01T00:00:00Z");
    await expect(
      withTx(db, async (tx) => {
        await nextNumber(tx, id, "REQ", at);
        throw new Error("the submission failed after numbering");
      }),
    ).rejects.toThrow("failed after numbering");
    expect(await withTx(db, (tx) => nextNumber(tx, id, "REQ", at))).toEqual({
      year: 2033,
      number: 1,
    });
  });

  it("counts each tenant on its own", async () => {
    const [a, b] = await Promise.all([
      seedTenant(pool, "req-own-a", [{ email: "owner@req-own-a.test" }]),
      seedTenant(pool, "req-own-b", [{ email: "owner@req-own-b.test" }]),
    ]);
    const at = new Date("2034-06-01T00:00:00Z");
    await withTx(db, (tx) => nextNumber(tx, a.id, "REQ", at));
    expect(await withTx(db, (tx) => nextNumber(tx, b.id, "REQ", at))).toEqual({
      year: 2034,
      number: 1,
    });
  });
});

describe("the catalog (R6.2)", () => {
  it("shows the active services with their forms and the active priorities in order", async () => {
    const res = await as("khalid").get("/requests/catalog");
    expect(res.status).toBe(200);
    expect(res.body.data.services).toHaveLength(1);
    expect(res.body.data.services[0]).toMatchObject({
      id: alNoor.serviceId,
      name: "Vendor contract review",
      form: { revision: 1 },
    });
    expect(res.body.data.services[0].form.fields.map((f: { label: string }) => f.label)).toEqual([
      "Vendor name",
      "Contract value",
      "Contract type",
      "Start date",
    ]);
    expect(res.body.data.priorities).toEqual([
      { id: alNoor.priorities.urgent, name: "Urgent", days: 2 },
      { id: alNoor.priorities.high, name: "High", days: 5 },
      { id: alNoor.priorities.normal, name: "Normal", days: 10 },
    ]);
  });

  it("is refused without request.submit", async () => {
    const roleId = await seedRole(pool, alNoor.tenantId, { name: "No requests", permissions: [] });
    const userId = await seedUser(pool, {
      email: "viewer@req-al-noor.test",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    await pool.query(
      "insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
      [alNoor.tenantId, userId, roleId],
    );
    const { access } = await login(app, "viewer@req-al-noor.test", "correct horse battery staple");
    expect((await asUser(app, access).get("/requests/catalog")).status).toBe(403);
    expect((await asUser(app, access).post("/requests", draft())).status).toBe(403);
  });
});

describe("submitting (R6.3-R6.6)", () => {
  it("stores the request in review with its copies, the answers snapshot, and the requester's unit", async () => {
    const res = await as("khalid").post("/requests", draft());
    expect(res.status).toBe(201);
    const request = res.body.data;
    expect(request).toMatchObject({
      state: "in_review",
      title: "Gulf Supplies contract",
      service: { id: alNoor.serviceId, name: "Vendor contract review" },
      priority: { name: "High", days: 5 },
      requester: { id: alNoor.ids.khalid, name: "Khalid" },
      handler: null,
      acceptedAt: null,
      deadline: null,
      sla: null,
      files: [],
    });
    expect(request.answers).toEqual([
      expect.objectContaining({
        value: "Gulf Supplies",
        field: expect.objectContaining({ label: "Vendor name" }),
      }),
      expect.objectContaining({ value: 480000 }),
      expect.objectContaining({
        value: alNoor.choices.supply,
        chosen: [{ id: alNoor.choices.supply, label: "Supply" }],
      }),
    ]);
    const row = await rowOf(request.id);
    expect(row).toMatchObject({
      requester_unit_id: alNoor.units.procurement,
      form_revision: 1,
      priority_name: "High",
      priority_days: 5,
    });
    expect(await auditOf(request.id)).toEqual([
      expect.objectContaining({
        action: "request.submitted",
        actor_id: alNoor.ids.khalid,
        details: expect.objectContaining({
          number: request.number,
          title: "Gulf Supplies contract",
        }),
      }),
    ]);
  });

  it("refuses answers the form does not accept, at the answer's path", async () => {
    const answers = vendorAnswers(alNoor);
    delete (answers as Record<string, unknown>)[alNoor.fields.vendorName];
    const res = await as("khalid").post("/requests", draft({ answers }));
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toEqual([
      { path: `answers.${alNoor.fields.vendorName}`, code: "required" },
    ]);
  });

  it("gives every answer all its keys: chosen only for choices, files only for file fields (R8.4)", async () => {
    const res = await as("khalid").post("/requests", draft());
    const answers = res.body.data.answers as {
      field: { type: string };
      chosen: unknown[] | null;
      files: unknown[] | null;
    }[];
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(Object.keys(answer).sort()).toEqual(["chosen", "field", "files", "value"]);
      expect(answer.files).toBeNull();
      const choice = answer.field.type.endsWith("_choice");
      expect(Array.isArray(answer.chosen)).toBe(choice);
    }
  });

  it("refuses an unknown or retired service and priority, and bad bodies", async () => {
    const unknown = await as("khalid").post(
      "/requests",
      draft({ serviceId: randomUUID(), priorityId: randomUUID() }),
    );
    expect(detailsOf(unknown)).toEqual([
      { path: "serviceId", code: "unknown_service" },
      { path: "priorityId", code: "unknown_priority" },
    ]);
    const spare = (await as("khalid").get("/requests/catalog")).body.data.priorities[2].id;
    await pool.query("update priorities set retired_at = now(), sort_order = null where id = $1", [
      spare,
    ]);
    const retired = await as("khalid").post("/requests", draft({ priorityId: spare }));
    expect(detailsOf(retired)).toEqual([{ path: "priorityId", code: "priority_retired" }]);
    await pool.query("update priorities set retired_at = null, sort_order = 3 where id = $1", [
      spare,
    ]);

    const blank = await as("khalid").post("/requests", draft({ title: "  " }));
    expect(detailsOf(blank)).toEqual([{ path: "title", code: "too_small" }]);
    const extra = await as("khalid").post("/requests", draft({ status: "completed" }));
    expect(detailsOf(extra)).toEqual([{ path: "status", code: "unknown_field" }]);
  });

  it("is refused in Grace and before escalation is configured (R6.4)", async () => {
    await setSubscriptionEnd(-1);
    try {
      const grace = await as("khalid").post("/requests", draft());
      expect(grace.status).toBe(403);
      expect(codeOf(grace)).toBe("SUBSCRIPTION_NOT_ACTIVE");
      expect((await as("khalid").get("/requests")).status).toBe(200);
    } finally {
      await setSubscriptionEnd(365);
    }
    await seedSubscribedTenant(pool, "req-no-escalation", [
      {
        email: "admin@req-noescalation.test",
        passwordHash: await hashPassword("correct horse battery staple"),
      },
    ]);
    const { access } = await login(
      app,
      "admin@req-noescalation.test",
      "correct horse battery staple",
    );
    const res = await asUser(app, access).post("/requests", draft());
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe("ESCALATION_NOT_CONFIGURED");
  });

  it("keeps what it copied when the service, the priority, or the requester's unit change (R6.5)", async () => {
    // Khalid holds a position that pins him to Procurement, so a colleague without one moves instead.
    const mover = await newMember(
      [
        { key: "request.submit", scope: "own" },
        { key: "request.view", scope: "own" },
      ],
      alNoor.units.procurement,
    );
    const res = await asUser(app, mover.access).post(
      "/requests",
      draft({ priorityId: alNoor.priorities.normal }),
    );
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    try {
      await pool.query("update priorities set days = 3 where id = $1", [alNoor.priorities.normal]);
      await pool.query("update services set name = 'Renamed service' where id = $1", [
        alNoor.serviceId,
      ]);
      await pool.query("update tenant_members set unit_id = $2 where user_id = $1", [
        mover.id,
        alNoor.units.litigation,
      ]);
      const read = (await asUser(app, mover.access).get(`/requests/${id}`)).body.data;
      expect(read.service.name).toBe("Vendor contract review");
      expect(read.priority).toEqual({ name: "Normal", days: 10 });
      expect((await rowOf(id)).requester_unit_id).toBe(alNoor.units.procurement);
      // Finance's manager still sees it through the recorded unit.
      expect((await as("majed").get(`/requests/${id}`)).status).toBe(200);
    } finally {
      await pool.query("update priorities set days = 10 where id = $1", [alNoor.priorities.normal]);
      await pool.query("update services set name = 'Vendor contract review' where id = $1", [
        alNoor.serviceId,
      ]);
    }
  });

  it("cannot be edited by the requester (R6.6)", async () => {
    const request = await submit("khalid");
    for (const send of [
      () => as("khalid").put(`/requests/${request.id}`, { title: "New" }),
      () =>
        as("khalid").put(`/requests/${request.id}/priority`, {
          priorityId: alNoor.priorities.urgent,
          reason: "x",
        }),
    ]) {
      expect([403, 404]).toContain((await send()).status);
    }
    expect((await rowOf(request.id)).title).toBe("Gulf Supplies contract");
  });
});

let memberCounter = 0;

/** A new active member of Al-Noor with the given grants and unit, logged in. */
async function newMember(
  permissions: { key: string; scope: string }[],
  unitId: string | null = null,
): Promise<{ access: string; id: string }> {
  const n = ++memberCounter;
  const email = `member${n}@req-al-noor.test`;
  const password = "correct horse battery staple";
  const id = await seedUser(pool, {
    email,
    userName: `Member ${n}`,
    passwordHash: await hashPassword(password),
  });
  const roleId = await seedRole(pool, alNoor.tenantId, { name: `Role ${n}`, permissions });
  await pool.query(
    "insert into tenant_members (tenant_id, user_id, role_id, unit_id) values ($1, $2, $3, $4)",
    [alNoor.tenantId, id, roleId, unitId],
  );
  return { access: (await login(app, email, password)).access, id };
}

const statusOf = async (access: string, id: string) =>
  (await request(app).get(`/requests/${id}`).set("Cookie", accessCookie(access))).status;

describe("who sees a request (R6.7)", () => {
  it("shows a request in review to its requester, reviewers, and the scopes that cover its unit", async () => {
    const { id } = await submit("khalid");
    const status = (person: PersonType) => statusOf(alNoor.tokens[person], id);
    expect(await status("khalid")).toBe(200);
    expect(await status("huda")).toBe(200); // organization scope, and a reviewer
    expect(await status("ahmed")).toBe(200);
    expect(await status("majed")).toBe(200); // department scope over Finance, which holds Procurement
    expect(await status("faisal")).toBe(404); // department scope over Legal Affairs
    expect(await status("nora")).toBe(404);
    expect(await status("reem")).toBe(404); // own scope, a colleague
    expect(await status("lina")).toBe(404);
    expect(await statusOf(rashid.admin, id)).toBe(404);
  });

  it("applies section scope to the section of the recorded unit", async () => {
    const { id } = await submit("khalid");
    const sameSection = await newMember(
      [{ key: "request.view", scope: "section" }],
      alNoor.units.procurement,
    );
    const otherSection = await newMember(
      [{ key: "request.view", scope: "section" }],
      alNoor.units.contracts,
    );
    const own = await newMember([{ key: "request.view", scope: "own" }], alNoor.units.procurement);
    expect(await statusOf(sameSection.access, id)).toBe(200);
    expect(await statusOf(otherSection.access, id)).toBe(404);
    expect(await statusOf(own.access, id)).toBe(404);
  });

  it("shows an accepted request to the handler and to the scopes that cover the handler's unit", async () => {
    const { id } = await submit("khalid");
    await accept(id, "faisal");
    expect(await statusOf(alNoor.tokens.faisal, id)).toBe(200); // the handler
    expect(await statusOf(alNoor.tokens.nora, id)).toBe(200); // department scope over Legal Affairs
    expect(await statusOf(alNoor.tokens.lina, id)).toBe(404);
    expect(await statusOf(alNoor.tokens.reem, id)).toBe(404);
  });

  it("shows a request in review to a reviewer without view rights, only while it is in review", async () => {
    const reviewer = await newMember([{ key: "request.review", scope: "organization" }]);
    const { id } = await submit("khalid");
    expect(await statusOf(reviewer.access, id)).toBe(200);
    const res = await as("huda").post(`/requests/${id}/reject`, { reason: "out of scope" });
    expect(res.status).toBe(200);
    expect(await statusOf(reviewer.access, id)).toBe(404);
  });

  it("records no unit for a requester without one, so only the organization scope sees it", async () => {
    const { id } = await submit("lina");
    expect((await rowOf(id)).requester_unit_id).toBeNull();
    expect(await statusOf(alNoor.tokens.lina, id)).toBe(200);
    expect(await statusOf(alNoor.tokens.huda, id)).toBe(200);
    expect(await statusOf(alNoor.tokens.majed, id)).toBe(404);
  });

  it("answers 404 for every route when the request is not visible or the id is malformed", async () => {
    const { id } = await submit("khalid");
    const reem = as("reem");
    expect((await reem.get(`/requests/${id}`)).status).toBe(404);
    expect((await reem.get("/requests/not-a-uuid")).status).toBe(404);
    expect(
      (
        await reem.put(`/requests/${id}/priority`, {
          priorityId: alNoor.priorities.urgent,
          reason: "r",
        })
      ).status,
    ).toBe(403);
    expect((await reem.post(`/requests/${id}/withdraw`, { reason: "r" })).status).toBe(404);
  });
});

describe("a deleted unit (R6.5)", () => {
  it("is cleared from old requests instead of blocking the delete", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "insert into org_units (tenant_id, kind, parent_id, name) values ($1, 'section', $2, 'Temporary') returning id",
      [alNoor.tenantId, alNoor.units.finance],
    );
    const unitId = rows[0]?.id ?? "";
    const temp = await newMember(
      [
        { key: "request.submit", scope: "own" },
        { key: "request.view", scope: "own" },
      ],
      unitId,
    );
    const res = await asUser(app, temp.access).post("/requests", draft());
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect((await rowOf(id)).requester_unit_id).toBe(unitId);

    await pool.query("update tenant_members set unit_id = null where user_id = $1", [temp.id]);
    const deleted = await request(app)
      .delete(`/org-units/${unitId}`)
      .set("Cookie", accessCookie(alNoor.tokens.sara));
    expect(deleted.status).toBe(204);
    expect((await rowOf(id)).requester_unit_id).toBeNull();
    expect(await statusOf(temp.access, id)).toBe(200);
    expect(await statusOf(alNoor.tokens.huda, id)).toBe(200);
    expect(await statusOf(alNoor.tokens.majed, id)).toBe(404);
  });
});

describe("a write answers as its read does (R8.2)", () => {
  it("returns the request of accept, priority, and withdraw exactly as GET does", async () => {
    const { id } = await submit("khalid");
    // The SLA of an open request is computed when read (D39), so during working hours its elapsed and awaiting
    // times grow between the write and the read; every other field must be equal.
    const live = { elapsedDays: expect.any(Number), awaitingInfoDays: expect.any(Number) };
    const read = async (person: PersonType) => {
      const body = (await as(person).get(`/requests/${id}`)).body;
      return body.data.sla ? { data: { ...body.data, sla: { ...body.data.sla, ...live } } } : body;
    };
    const priority = await as("huda").put(`/requests/${id}/priority`, {
      priorityId: alNoor.priorities.urgent,
      reason: "Board deadline",
    });
    expect(priority.status).toBe(200);
    expect(priority.body).toEqual(await read("huda"));
    const accepted = await as("huda").post(`/requests/${id}/accept`, {
      handlerId: alNoor.ids.faisal,
      workflowId: alNoor.workflows.vendor,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual(await read("huda"));

    const other = await submit("khalid");
    const withdrawn = await as("khalid").post(`/requests/${other.id}/withdraw`, {
      reason: "Duplicate",
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toEqual((await as("khalid").get(`/requests/${other.id}`)).body);
  });
});

describe("listing requests (R6.8)", () => {
  it("lists what the caller requested, handles, and may review, by view", async () => {
    const mine = await submit("khalid");
    const hers = await submit("lina");
    const idsOf = async (person: PersonType, query: string) =>
      ((await as(person).get(`/requests?${query}&limit=100`)).body.data as { id: string }[]).map(
        (r) => r.id,
      );

    const requested = await idsOf("khalid", "view=requested");
    expect(requested).toContain(mine.id);
    expect(requested).not.toContain(hers.id);

    const queue = await idsOf("huda", "view=review_queue");
    expect(queue).toEqual(expect.arrayContaining([mine.id, hers.id]));
    expect(await idsOf("majed", "view=review_queue")).toEqual([]);

    await accept(mine.id, "nora");
    expect(await idsOf("huda", "view=review_queue")).not.toContain(mine.id);
    expect(await idsOf("nora", "view=handling")).toEqual([mine.id]);
    expect(await idsOf("khalid", "view=handling")).toEqual([]);
  });

  it("filters by state and service, and pages newest first with a total", async () => {
    const paula = await newMember(
      [
        { key: "request.submit", scope: "own" },
        { key: "request.view", scope: "own" },
      ],
      alNoor.units.litigation,
    );
    for (const title of ["one", "two", "three"]) {
      const res = await asUser(app, paula.access).post("/requests", draft({ title }));
      expect(res.status).toBe(201);
    }
    const list = (query: string) => asUser(app, paula.access).get(`/requests?${query}`);
    const titles = (res: { body: { data: { title: string }[] } }) =>
      res.body.data.map((r) => r.title);

    const firstPage = await list("limit=2");
    expect(firstPage.body.page.total).toBe(3);
    expect(titles(firstPage)).toEqual(["three", "two"]);
    expect(firstPage.body.page.nextCursor).toEqual(expect.any(String));
    const secondPage = await list(`limit=2&cursor=${firstPage.body.page.nextCursor}`);
    expect(titles(secondPage)).toEqual(["one"]);
    expect(secondPage.body.page).toEqual({ nextCursor: null, total: 3 });
    expect((await list("limit=0")).status).toBe(400);

    expect((await list("state=in_progress")).body).toEqual({
      data: [],
      page: { nextCursor: null, total: 0 },
    });
    expect((await list("state=all")).body.page.total).toBe(3);
    expect((await list("state=lost")).body.error.details).toEqual([
      { path: "state", code: "invalid_value" },
    ]);
    expect((await list("serviceId=nope")).body.error.details).toEqual([
      { path: "serviceId", code: "invalid_value" },
    ]);
    const replay = await list(`limit=2&state=in_review&cursor=${firstPage.body.page.nextCursor}`);
    expect(replay.body.error.details).toEqual([{ path: "cursor", code: "invalid_cursor" }]);
    const spelled = await list(
      `limit=2&state=all&serviceId=all&cursor=${firstPage.body.page.nextCursor}`,
    );
    expect(titles(spelled)).toEqual(["one"]);
    expect((await list("state=in_review")).body.page.total).toBe(3);
    expect((await list(`serviceId=${alNoor.serviceId}`)).body.page.total).toBe(3);
    expect((await list(`serviceId=${randomUUID()}`)).body.page.total).toBe(0);
  });

  it("summarizes a request with its people, priority, and times", async () => {
    const { id } = await submit("khalid");
    const summary = (await as("huda").get("/requests?view=review_queue&limit=100")).body.data.find(
      (r: { id: string }) => r.id === id,
    );
    expect(summary).toEqual({
      id,
      number: expect.stringMatching(/^REQ-\d+-\d{4}$/),
      title: "Gulf Supplies contract",
      state: "in_review",
      service: { id: alNoor.serviceId, name: "Vendor contract review" },
      priority: { name: "High", days: 5 },
      requester: { id: alNoor.ids.khalid, name: "Khalid" },
      handler: null,
      submittedAt: expect.any(String),
      acceptedAt: null,
      closedAt: null,
      deadline: null,
      activeStage: null,
    });
  });
});

describe("changing the priority in review (R6.9)", () => {
  it("lets a reviewer raise it with a reason, audited with both levels", async () => {
    const { id } = await submit("khalid");
    const res = await as("huda").put(`/requests/${id}/priority`, {
      priorityId: alNoor.priorities.urgent,
      reason: "board meeting on Thursday",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.priority).toEqual({ name: "Urgent", days: 2 });
    expect(await auditOf(id)).toContainEqual(
      expect.objectContaining({
        action: "request.priority_changed",
        actor_id: alNoor.ids.huda,
        details: {
          before: { name: "High", days: 5 },
          after: { name: "Urgent", days: 2 },
          reason: "board meeting on Thursday",
        },
      }),
    );
  });

  it("needs a reason and an active priority, a reviewer, and a request in review", async () => {
    const { id } = await submit("khalid");
    const send = (person: PersonType, body: object) =>
      as(person).put(`/requests/${id}/priority`, body);
    expect(detailsOf(await send("huda", { priorityId: alNoor.priorities.urgent }))).toEqual([
      { path: "reason", code: "invalid_type" },
    ]);
    expect(detailsOf(await send("huda", { priorityId: randomUUID(), reason: "r" }))).toEqual([
      { path: "priorityId", code: "unknown_priority" },
    ]);
    expect(
      (await send("khalid", { priorityId: alNoor.priorities.urgent, reason: "r" })).status,
    ).toBe(403);
    await accept(id);
    const locked = await send("huda", { priorityId: alNoor.priorities.urgent, reason: "late" });
    expect(locked.status).toBe(409);
    expect(codeOf(locked)).toBe("INVALID_REQUEST_STATE");
  });

  it("changes nothing when the priority is the same", async () => {
    const { id } = await submit("khalid");
    const res = await as("huda").put(`/requests/${id}/priority`, {
      priorityId: alNoor.priorities.high,
      reason: "no change",
    });
    expect(res.status).toBe(200);
    expect((await auditOf(id)).map((entry) => entry.action)).toEqual(["request.submitted"]);
  });
});

describe("accepting (R6.10, R6.11)", () => {
  it("starts the clock and takes the workflow's current version", async () => {
    const { id } = await submit("khalid");
    const res = await as("huda").post(`/requests/${id}/accept`, {
      handlerId: alNoor.ids.faisal,
      workflowId: alNoor.workflows.vendor,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      state: "in_progress",
      handler: { id: alNoor.ids.faisal, name: "Faisal" },
      acceptedAt: expect.any(String),
      deadline: expect.any(String),
      sla: { met: true, breachDays: 0, awaitingInfoDays: 0 },
      allowedActions: ["reassign"],
    });
    const row = await rowOf(id);
    const { rows } = await pool.query("select current_version_id from workflows where id = $1", [
      alNoor.workflows.vendor,
    ]);
    expect(row).toMatchObject({
      workflow_id: alNoor.workflows.vendor,
      workflow_version_id: rows[0].current_version_id,
      handler_unit_id: alNoor.units.contracts,
      accepted_by: alNoor.ids.huda,
    });
    expect(await auditOf(id)).toContainEqual(
      expect.objectContaining({
        action: "request.accepted",
        details: expect.objectContaining({ handlerId: alNoor.ids.faisal }),
      }),
    );
  });

  it("lets a reviewer choose themselves", async () => {
    const { id } = await submit("khalid");
    expect((await accept(id, "huda")).handler.id).toBe(alNoor.ids.huda);
  });

  it("checks the handler against the database (R6.11, R6.27)", async () => {
    const { id } = await submit("khalid");
    const accepting = (handlerId: string) =>
      as("huda").post(`/requests/${id}/accept`, { handlerId, workflowId: alNoor.workflows.vendor });
    expect(detailsOf(await accepting(alNoor.ids.khalid))).toEqual([
      { path: "handlerId", code: "handler_is_requester" },
    ]);
    expect(detailsOf(await accepting(alNoor.ids.reem))).toEqual([
      { path: "handlerId", code: "handler_not_eligible" },
    ]);
    expect(detailsOf(await accepting(rashid.userId))).toEqual([
      { path: "handlerId", code: "handler_not_eligible" },
    ]);
    expect(detailsOf(await accepting(randomUUID()))).toEqual([
      { path: "handlerId", code: "handler_not_eligible" },
    ]);
    await pool.query("update users set is_active = false where id = $1", [alNoor.ids.nora]);
    try {
      expect(detailsOf(await accepting(alNoor.ids.nora))).toEqual([
        { path: "handlerId", code: "handler_not_eligible" },
      ]);
    } finally {
      await pool.query("update users set is_active = true where id = $1", [alNoor.ids.nora]);
    }
    expect((await rowOf(id)).state).toBe("in_review");
  });

  it("takes only an active workflow the service allows", async () => {
    const { id } = await submit("khalid");
    const accepting = (workflowId: string) =>
      as("huda").post(`/requests/${id}/accept`, { handlerId: alNoor.ids.faisal, workflowId });
    expect(detailsOf(await accepting(randomUUID()))).toEqual([
      { path: "workflowId", code: "unknown_workflow" },
    ]);
    const stray = (
      await as("sara").post("/workflows", {
        name: "Not offered",
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
    ).body.data.id;
    expect(detailsOf(await accepting(stray))).toEqual([
      { path: "workflowId", code: "workflow_not_allowed" },
    ]);
    await pool.query("update workflows set retired_at = now() where id = $1", [
      alNoor.workflows.complex,
    ]);
    try {
      expect(detailsOf(await accepting(alNoor.workflows.complex))).toEqual([
        { path: "workflowId", code: "workflow_retired" },
      ]);
    } finally {
      await pool.query("update workflows set retired_at = null where id = $1", [
        alNoor.workflows.complex,
      ]);
    }
  });

  it("is for reviewers, and only for a request in review", async () => {
    const { id } = await submit("khalid");
    const body = { handlerId: alNoor.ids.faisal, workflowId: alNoor.workflows.vendor };
    expect((await as("faisal").post(`/requests/${id}/accept`, body)).status).toBe(403);
    await accept(id);
    const again = await as("huda").post(`/requests/${id}/accept`, body);
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe("INVALID_REQUEST_STATE");
  });

  it("checks the reviewer's role as it is now, not the token", async () => {
    const { id } = await submit("khalid");
    await pool.query("update tenant_members set role_id = $2 where user_id = $1", [
      alNoor.ids.ahmed,
      alNoor.roles.member,
    ]);
    try {
      const res = await as("ahmed").post(`/requests/${id}/accept`, {
        handlerId: alNoor.ids.faisal,
        workflowId: alNoor.workflows.vendor,
      });
      expect(res.status).toBe(403);
      expect(codeOf(res)).toBe("PERMISSION_NOT_HELD");
    } finally {
      await pool.query("update tenant_members set role_id = $2 where user_id = $1", [
        alNoor.ids.ahmed,
        alNoor.roles.head,
      ]);
    }
  });
});

describe("rejecting and withdrawing (R6.12)", () => {
  it("lets a reviewer reject a request in review with a reason", async () => {
    const { id } = await submit("khalid");
    const res = await as("huda").post(`/requests/${id}/reject`, { reason: "Not a legal matter" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      state: "rejected",
      closedAt: expect.any(String),
      sla: null,
    });
    expect(await rowOf(id)).toMatchObject({
      closed_by: alNoor.ids.huda,
      close_reason: "Not a legal matter",
      sla_deadline: null,
    });
    expect(await auditOf(id)).toContainEqual(
      expect.objectContaining({
        action: "request.rejected",
        details: { reason: "Not a legal matter" },
      }),
    );
    expect(detailsOf(await as("huda").post(`/requests/${id}/reject`, {}))).toEqual([
      { path: "reason", code: "invalid_type" },
    ]);
  });

  it("lets the requester withdraw a request in review, and nobody else", async () => {
    const { id } = await submit("khalid");
    const body = { reason: "Found another way" };
    expect((await as("lina").post(`/requests/${id}/withdraw`, body)).status).toBe(404);
    expect((await as("huda").post(`/requests/${id}/withdraw`, body)).status).toBe(403);
    const res = await as("khalid").post(`/requests/${id}/withdraw`, body);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe("withdrawn");
    expect((await rowOf(id)).close_reason).toBe("Found another way");
  });

  it("refuses both after acceptance and after closure", async () => {
    const accepted = await submit("khalid");
    await accept(accepted.id);
    for (const [person, route] of [
      ["khalid", "withdraw"],
      ["huda", "reject"],
    ] as const) {
      const res = await as(person).post(`/requests/${accepted.id}/${route}`, { reason: "late" });
      expect(res.status).toBe(409);
      expect(codeOf(res)).toBe("INVALID_REQUEST_STATE");
    }
    const closed = await submit("khalid");
    await as("khalid").post(`/requests/${closed.id}/withdraw`, { reason: "done" });
    const again = await as("huda").post(`/requests/${closed.id}/reject`, { reason: "late" });
    expect(codeOf(again)).toBe("INVALID_REQUEST_STATE");
  });

  it("serializes accept against withdraw on the request row (P6.8)", async () => {
    const { id } = await submit("khalid");
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from requests where id = $1 for update", [id]);
      const accepting = as("huda").post(`/requests/${id}/accept`, {
        handlerId: alNoor.ids.faisal,
        workflowId: alNoor.workflows.vendor,
      });
      const withdrawing = as("khalid").post(`/requests/${id}/withdraw`, {
        reason: "changed my mind",
      });
      const both = Promise.all([accepting, withdrawing]);
      await waitUntilBlockedOn(pool, "requests");
      await holder.query("commit");
      const [accepted, withdrawn] = await both;
      expect([accepted.status, withdrawn.status].sort()).toEqual([200, 409]);
      const loser = accepted.status === 409 ? accepted : withdrawn;
      expect(codeOf(loser)).toBe("INVALID_REQUEST_STATE");
      expect((await rowOf(id)).state).toBe(accepted.status === 200 ? "in_progress" : "withdrawn");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
  });
});

describe("the SLA deadline (R6.22)", () => {
  const nextSundayAfter = (daysAhead: number): string => {
    const { date } = toRiyadh(new Date(Date.now() + daysAhead * 86_400_000));
    const base = new Date(`${date}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + ((7 - base.getUTCDay()) % 7));
    return base.toISOString().slice(0, 10);
  };
  const plusDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const at10 = (date: string) => fromRiyadh(date, 10 * 3_600_000).toISOString();

  it("follows a holiday declared after acceptance", async () => {
    const sunday = nextSundayAfter(30);
    const { id } = await submit("khalid");
    await accept(id);
    await pool.query("update requests set accepted_at = $2 where id = $1", [id, at10(sunday)]);

    const deadline = async () =>
      new Date((await as("huda").get(`/requests/${id}`)).body.data.deadline).toISOString();
    // Sunday 10:00 plus five working days (Friday and Saturday are off) is the next Sunday 10:00.
    expect(await deadline()).toBe(at10(plusDays(sunday, 7)));

    const holiday = await as("sara").post("/calendar/periods", {
      kind: "holiday",
      name: "Declared late",
      recurrence: "once",
      startDate: plusDays(sunday, 3),
      endDate: plusDays(sunday, 3),
    });
    expect(holiday.status).toBe(201);
    expect(await deadline()).toBe(at10(plusDays(sunday, 8)));
    const listed = (await as("huda").get("/requests?state=in_progress&limit=100")).body.data.find(
      (r: { id: string }) => r.id === id,
    );
    expect(new Date(listed.deadline).toISOString()).toBe(at10(plusDays(sunday, 8)));
  });
});

describe("subscription states and isolation (R6.26, R6.27)", () => {
  it("lets everything but submission work in Grace, and refuses every write in Read-only", async () => {
    const waiting = await submit("khalid");
    const other = await submit("khalid");
    await setSubscriptionEnd(-1);
    try {
      const raised = await as("huda").put(`/requests/${waiting.id}/priority`, {
        priorityId: alNoor.priorities.urgent,
        reason: "grace",
      });
      expect(raised.status).toBe(200);
      await setSubscriptionEnd(-30);
      const accepting = await as("huda").post(`/requests/${other.id}/accept`, {
        handlerId: alNoor.ids.faisal,
        workflowId: alNoor.workflows.vendor,
      });
      expect(accepting.status).toBe(403);
      expect(codeOf(accepting)).toBe("SUBSCRIPTION_READ_ONLY");
      const withdrawing = await as("khalid").post(`/requests/${other.id}/withdraw`, {
        reason: "r",
      });
      expect(withdrawing.status).toBe(403);
      expect((await as("huda").get(`/requests/${other.id}`)).status).toBe(200);
      expect((await as("huda").get("/requests")).status).toBe(200);
    } finally {
      await setSubscriptionEnd(365);
    }
  });

  it("writes an audit entry for every action in its own tenant", async () => {
    const { id } = await submit("khalid");
    await as("huda").put(`/requests/${id}/priority`, {
      priorityId: alNoor.priorities.normal,
      reason: "r",
    });
    await accept(id);
    const { rows } = await pool.query(
      "select action, tenant_id from audit_log where resource_id = $1 order by id",
      [id],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "request.submitted",
      "request.priority_changed",
      "request.accepted",
    ]);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([alNoor.tenantId]));
  });

  it("never reaches another tenant's rows", async () => {
    const mine = await submit("khalid");
    const theirs = await asUser(app, rashid.admin).get("/requests");
    expect(theirs.body).toEqual({ data: [], page: { nextCursor: null, total: 0 } });
    const attempt = await asUser(app, rashid.admin).post(`/requests/${mine.id}/accept`, {
      handlerId: rashid.userId,
      workflowId: alNoor.workflows.vendor,
    });
    expect(attempt.status).toBe(404);
    const submitting = await asUser(app, rashid.admin).post("/requests", draft());
    expect(submitting.status).toBe(400);
    expect(detailsOf(submitting)).toEqual([
      { path: "serviceId", code: "unknown_service" },
      { path: "priorityId", code: "unknown_priority" },
    ]);
    const handler = await as("huda").post(`/requests/${mine.id}/accept`, {
      handlerId: rashid.userId,
      workflowId: alNoor.workflows.vendor,
    });
    expect(detailsOf(handler)).toEqual([{ path: "handlerId", code: "handler_not_eligible" }]);
  });
});
