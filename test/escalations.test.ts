import type express from "express";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/pool.js";
import { buildJobs } from "../src/jobs.js";
import { createLogger } from "../src/logging/logger.js";
import { checkEscalations, createEscalationsJob } from "../src/modules/requests/index.js";
import {
  type AlNoorType,
  asUser,
  type PersonType,
  seedAlNoor,
  vendorAnswers,
} from "./helpers/al-noor.js";
import { testApp } from "./helpers/app.js";
import { createIsolatedDb, type IsolatedDbType, seedRole } from "./helpers/db.js";
import { captureLogs, type LogCapture } from "./helpers/log-capture.js";
import { connectToTestStore } from "./helpers/storage.js";

// Phase 7 spec, step 7.3: the escalation check (R7.1-R7.10) and section 5.
// The check works on every tenant's open requests, so this file runs in a database of its own.

const RUN_ID = "job:requests.escalations:test";
const NONE = { r0: 0, r1: 0, r2: 0, skippedLocked: 0, failed: 0 };

let isolated: IsolatedDbType;
let pool: pg.Pool;
let db: Db;
let app: express.Express;
let alNoor: AlNoorType;
let rashid: AlNoorType;
let capture: LogCapture;

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const id = (person: PersonType) => alNoor.ids[person];

/** A Riyadh wall-clock time such as "2026-11-04T16:00". */
const at = (local: string) => new Date(`${local}+03:00`);

type Target = { position: string } | { builtin: string };
interface Settings {
  r0: { enabled: boolean; days: number; recipients: Target[] };
  r1: { enabled: boolean; percent: number; recipients: Target[] };
  r2: { enabled: boolean; recipients: Target[] };
}

const specSettings = (): Settings => ({
  r0: { enabled: true, days: 2, recipients: [{ position: alNoor.positions.legalIntake }] },
  r1: { enabled: true, percent: 75, recipients: [{ builtin: "handler" }] },
  r2: {
    enabled: true,
    recipients: [
      { builtin: "handler" },
      { builtin: "handler_unit_managers" },
      { builtin: "handler_department_managers" },
    ],
  },
});

async function configure(
  settings: Settings,
  tenant: AlNoorType = alNoor,
  person: PersonType = "sara",
) {
  const res = await asUser(app, tenant.tokens[person]).put("/escalation", settings);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const draft = (tenant: AlNoorType, priorityId: string, title: string) => ({
  serviceId: tenant.serviceId,
  priorityId,
  title,
  answers: vendorAnswers(tenant),
});

async function submit(
  tenant: AlNoorType,
  person: PersonType,
  priorityId: string,
  title: string,
): Promise<string> {
  const res = await asUser(app, tenant.tokens[person]).post(
    "/requests",
    draft(tenant, priorityId, title),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.request.id;
}

async function acceptRequest(
  tenant: AlNoorType,
  requestId: string,
  handler: PersonType = "faisal",
): Promise<void> {
  const res = await asUser(app, tenant.tokens.huda).post(`/requests/${requestId}/accept`, {
    handlerId: tenant.ids[handler],
    workflowId: tenant.workflows.vendor,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** The inbox rows the API itself wrote while setting a request up are not the subject of these tests. */
const clearNotifications = () => pool.query("delete from notifications");

/** Submitted and accepted at the given times (the API stamps the real time). */
async function setTimes(
  requestId: string,
  times: { submitted: string; accepted?: string },
): Promise<void> {
  await pool.query(
    "update requests set submitted_at = $2, accepted_at = coalesce($3::timestamptz, accepted_at) where id = $1",
    [requestId, at(times.submitted), times.accepted ? at(times.accepted) : null],
  );
}

/** #42 of the spec: Khalid, High (5 days), accepted Sunday 2026-11-01 10:00 with Faisal as handler. */
async function open42(tenant: AlNoorType = alNoor, title = "Gulf Supplies contract") {
  const requestId = await submit(tenant, "khalid", tenant.priorities.high, title);
  await acceptRequest(tenant, requestId);
  await setTimes(requestId, { submitted: "2026-11-01T09:00", accepted: "2026-11-01T10:00" });
  await clearNotifications();
  return requestId;
}

/** #43 of the spec: Khalid, Normal, submitted Monday 2026-11-02 at 09:00 and not yet reviewed. */
async function open43(title = "Al Safa lease review") {
  const requestId = await submit(alNoor, "khalid", alNoor.priorities.normal, title);
  await setTimes(requestId, { submitted: "2026-11-02T09:00" });
  await clearNotifications();
  return requestId;
}

async function closeAsCompleted(requestId: string, closedBy: PersonType = "faisal") {
  await pool.query(
    `update requests set state = 'completed', closed_at = now(), closed_by = $2, sla_deadline = now(),
       elapsed_days = 0, breach_days = 0, awaiting_info_days = 0, sla_met = true where id = $1`,
    [requestId, id(closedBy)],
  );
}

const closeAllOpen = async () => {
  await pool.query(
    `update requests set state = 'withdrawn', closed_at = now(), closed_by = requester_id, close_reason = 'test'
     where state = 'in_review'`,
  );
  await pool.query(
    `update requests set state = 'completed', closed_at = now(), closed_by = handler_id, sla_deadline = now(),
       elapsed_days = 0, breach_days = 0, awaiting_info_days = 0, sla_met = true where state = 'in_progress'`,
  );
};

const check = (now: string, extra: Partial<Parameters<typeof checkEscalations>[1]> = {}) =>
  checkEscalations(db, { logger: capture.logger, runId: RUN_ID, now: at(now), ...extra });

const nameOf = (userId: string) =>
  Object.entries(alNoor.ids).find(([, value]) => value === userId)?.[0];

interface InboxRowType {
  kind: string;
  data: Record<string, unknown>;
  request_id: string | null;
}

async function inbox(person: PersonType, tenant: AlNoorType = alNoor): Promise<InboxRowType[]> {
  const { rows } = await pool.query<InboxRowType>(
    "select kind, data, request_id from notifications where user_id = $1 order by created_at, id",
    [tenant.ids[person]],
  );
  return rows;
}

/** Who was told, by name, across the tenant. */
async function told(kind: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    "select user_id from notifications where kind = $1 and tenant_id = $2",
    [kind, alNoor.tenantId],
  );
  return rows.map((row) => nameOf(row.user_id) ?? "?").sort();
}

const firings = (requestId: string) =>
  pool
    .query<{ rule: string; due_at: Date; fired_at: Date }>(
      "select rule, due_at, fired_at from request_escalations where request_id = $1 order by fired_at, rule",
      [requestId],
    )
    .then((result) => result.rows);

const auditOf = (requestId: string) =>
  pool
    .query(
      "select actor_type, actor_id, resource_type, details, request_id from audit_log where action = 'request.escalated' and resource_id = $1 order by id",
      [requestId],
    )
    .then((result) => result.rows);

const notificationCount = () =>
  pool
    .query<{ n: number }>("select count(*)::int as n from notifications")
    .then((result) => result.rows[0]?.n ?? 0);

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  db = createDb(pool);
  app = testApp(pool, createLogger("silent"));
  alNoor = await seedAlNoor(pool, app, "esc-chk-al-noor");
  rashid = await seedAlNoor(pool, app, "esc-chk-al-rashid");
  // The spec's dates are fixed, so the hours must have applied since before them whatever day this runs.
  await pool.query("update working_hours set effective_from = '2020-01-01'");
});

afterAll(async () => {
  await isolated.drop();
});

beforeEach(async () => {
  capture = captureLogs();
  await closeAllOpen();
  await clearNotifications();
  await pool.query("delete from request_escalations");
  await pool.query("update users set is_active = true");
  await configure(specSettings());
});

describe("the requests.escalations job (R7.1)", () => {
  it("is a one-minute job in the list of jobs, and a run on a quiet database does nothing", async () => {
    const job = createEscalationsJob();
    expect(job).toMatchObject({ name: "requests.escalations", intervalMs: 60_000 });
    expect(buildJobs({ fileStore: connectToTestStore() }).map((entry) => entry.name)).toContain(
      "requests.escalations",
    );
    expect(
      await job.run({
        db,
        logger: capture.logger,
        signal: new AbortController().signal,
        runId: RUN_ID,
      }),
    ).toEqual(NONE);
  });

  it("reads the database clock when no moment is given", async () => {
    const requestId = await submit(alNoor, "khalid", alNoor.priorities.high, "Fresh request");
    expect(await checkEscalations(db, { logger: capture.logger, runId: RUN_ID })).toEqual(NONE);
    expect(await firings(requestId)).toEqual([]);
  });
});

describe("R0 (R7.2)", () => {
  it("fires two working days after submission, to Legal Intake", async () => {
    const requestId = await open43();
    expect(await check("2026-11-04T08:59")).toEqual(NONE);
    expect(await check("2026-11-04T09:01")).toEqual({ ...NONE, r0: 1 });

    expect(await inbox("ahmed")).toEqual([
      {
        kind: "request.review_overdue",
        request_id: requestId,
        data: {
          number: expect.stringMatching(/^REQ-\d+-\d{4}$/),
          title: "Al Safa lease review",
          dueAt: at("2026-11-04T09:00").toISOString(),
        },
      },
    ]);
    expect(await notificationCount()).toBe(1);
  });

  it("fires at the exact moment it is due", async () => {
    await open43();
    expect(await check("2026-11-04T09:00")).toEqual({ ...NONE, r0: 1 });
  });

  it("never fires on a request accepted, rejected, or withdrawn before then", async () => {
    const accepted = await open43("Accepted in time");
    await acceptRequest(alNoor, accepted);
    await setTimes(accepted, { submitted: "2026-11-02T09:00", accepted: "2026-11-03T10:00" });

    const rejected = await open43("Rejected in time");
    const rejection = await as("huda").post(`/requests/${rejected}/reject`, {
      reason: "Out of scope",
    });
    expect(rejection.status, JSON.stringify(rejection.body)).toBe(200);

    const withdrawn = await open43("Withdrawn in time");
    const withdrawal = await as("khalid").post(`/requests/${withdrawn}/withdraw`, {
      reason: "No longer needed",
    });
    expect(withdrawal.status, JSON.stringify(withdrawal.body)).toBe(200);
    await clearNotifications();

    expect(await check("2026-11-04T09:01")).toEqual(NONE);
    expect(await notificationCount()).toBe(0);
  });
});

describe("R1 (R7.3)", () => {
  it("fires at 75% of the deadline, to the handler, with the deadline", async () => {
    const requestId = await open42();
    expect(await check("2026-11-04T15:59")).toEqual(NONE);
    expect(await check("2026-11-04T16:00")).toEqual({ ...NONE, r1: 1 });

    expect(await inbox("faisal")).toEqual([
      {
        kind: "request.at_risk",
        request_id: requestId,
        data: {
          number: expect.any(String),
          title: "Gulf Supplies contract",
          dueAt: at("2026-11-04T16:00").toISOString(),
          deadline: at("2026-11-08T10:00").toISOString(),
        },
      },
    ]);
    expect(await notificationCount()).toBe(1);
  });

  it("does not fire R1 after the deadline has passed (R7.6)", async () => {
    const requestId = await open42();
    expect(await check("2026-11-08T10:01")).toEqual({ ...NONE, r2: 1 });
    expect((await firings(requestId)).map((row) => row.rule)).toEqual(["r2"]);
  });
});

describe("R2 (R7.4, R7.8)", () => {
  it("fires after the deadline, to the handler and the managers, once each", async () => {
    await open42();
    await check("2026-11-04T16:00");
    expect(await check("2026-11-08T10:00")).toEqual(NONE);
    expect(await check("2026-11-08T10:01")).toEqual({ ...NONE, r2: 1 });

    expect(await told("request.breached")).toEqual(["ahmed", "faisal", "huda"]);
    const faisal = await inbox("faisal");
    expect(faisal.map((row) => row.kind)).toEqual(["request.at_risk", "request.breached"]);
    expect(faisal[1]?.data).toMatchObject({
      dueAt: at("2026-11-08T10:00").toISOString(),
      deadline: at("2026-11-08T10:00").toISOString(),
    });
  });

  it("climbs a target that finds nobody, and skips one that is empty at every level", async () => {
    const requestId = await open43();
    await pool.query("update users set is_active = false where id = $1", [id("ahmed")]);
    await check("2026-11-04T09:01");
    expect(await told("request.review_overdue")).toEqual(["huda"]);

    const [entry] = await auditOf(requestId);
    expect(entry.details.targets).toEqual([
      {
        target: { position: alNoor.positions.legalIntake },
        level: { kind: "managers", unitId: alNoor.units.legal },
        userIds: [id("huda")],
      },
    ]);
  });

  it("tells the holders of escalation.manage when nobody is found for any target", async () => {
    const manager = await seedRole(pool, alNoor.tenantId, {
      name: "Escalation manager",
      permissions: [{ key: "escalation.manage", scope: "organization" }],
    });
    await pool.query("update tenant_members set role_id = $2 where user_id = $1", [
      id("lina"),
      manager,
    ]);
    const requestId = await open43();
    await pool.query("update users set is_active = false where id in ($1, $2)", [
      id("ahmed"),
      id("huda"),
    ]);

    expect(await check("2026-11-04T09:01")).toEqual({ ...NONE, r0: 1 });

    expect(await told("escalation.no_recipients")).toEqual(["lina", "sara"]);
    expect(await told("request.review_overdue")).toEqual([]);
    expect((await inbox("sara"))[0]?.data).toEqual({
      number: expect.any(String),
      title: "Al Safa lease review",
      rule: "r0",
    });
    expect(await firings(requestId)).toHaveLength(1);
    const [entry] = await auditOf(requestId);
    expect(entry.details).toMatchObject({ rule: "r0", noRecipients: true });
    expect([...entry.details.recipients].sort()).toEqual([id("lina"), id("sara")].sort());
  });

  it("notifies a recipient who cannot see the request, with its number, title, and deadline", async () => {
    const requestId = await submit(alNoor, "lina", alNoor.priorities.high, "Lina's private matter");
    await acceptRequest(alNoor, requestId);
    await setTimes(requestId, { submitted: "2026-11-01T09:00", accepted: "2026-11-01T10:00" });
    await configure({
      ...specSettings(),
      r1: {
        enabled: true,
        percent: 75,
        recipients: [{ position: alNoor.positions.procurementReviewer }],
      },
    });
    await clearNotifications();

    await check("2026-11-04T16:00");

    const [row] = await inbox("khalid");
    expect(row).toMatchObject({
      kind: "request.at_risk",
      data: { title: "Lina's private matter", deadline: at("2026-11-08T10:00").toISOString() },
    });
    expect((await as("khalid").get(`/requests/${requestId}`)).status).toBe(404);
  });
});

describe("firing at most once (R7.5)", () => {
  it("fires once when two runners check the same minute at the same time", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await clearNotifications();

    const [first, second] = await Promise.all([
      check("2026-11-08T10:01"),
      check("2026-11-08T10:01"),
    ]);

    expect(first.r2 + second.r2).toBe(1);
    expect((await firings(requestId)).filter((row) => row.rule === "r2")).toHaveLength(1);
    expect(await told("request.breached")).toEqual(["ahmed", "faisal", "huda"]);
  });

  it("stops when another runner fired it after this one read its candidates", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await clearNotifications();

    let scanned: () => void = () => {};
    const bScanned = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = check("2026-11-08T10:01", {
      afterScan: async () => {
        scanned();
        await gate;
      },
    });
    await bScanned;
    const fast = await check("2026-11-08T10:01");
    release();
    const late = await slow;

    expect(fast).toEqual({ ...NONE, r2: 1 });
    expect(late).toEqual(NONE);
    expect(await told("request.breached")).toEqual(["ahmed", "faisal", "huda"]);
    expect(await auditOf(requestId)).toHaveLength(2);
  });

  it("shows the firings on the request, in the order they fired", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await check("2026-11-08T10:01");

    const res = await as("huda").get(`/requests/${requestId}`);
    expect(res.status).toBe(200);
    expect(res.body.request.escalations).toEqual([
      { rule: "r1", dueAt: at("2026-11-04T16:00").toISOString(), firedAt: expect.any(String) },
      { rule: "r2", dueAt: at("2026-11-08T10:00").toISOString(), firedAt: expect.any(String) },
    ]);
    const [r1, r2] = res.body.request.escalations;
    expect(new Date(r1.firedAt) <= new Date(r2.firedAt)).toBe(true);
  });

  it("shows no firings on a request nothing fired on", async () => {
    const requestId = await open42();
    expect((await as("huda").get(`/requests/${requestId}`)).body.request.escalations).toEqual([]);
  });

  it("keeps a firing when a holiday later moves the moment it was due, and R2 waits for the new deadline", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    const [before] = await firings(requestId);

    await pool.query(
      `insert into calendar_periods (tenant_id, kind, name, recurrence, start_date, end_date)
       values ($1, 'holiday', 'Founding day', 'once', '2026-11-05', '2026-11-05')`,
      [alNoor.tenantId],
    );
    expect(await check("2026-11-08T10:01")).toEqual(NONE);
    expect(await firings(requestId)).toEqual([before]);
    expect(await check("2026-11-09T10:01")).toEqual({ ...NONE, r2: 1 });
    await pool.query("delete from calendar_periods where tenant_id = $1", [alNoor.tenantId]);
  });

  it("records the moment it was due apart from when people were told, after downtime (R7.6)", async () => {
    const requestId = await open42();
    const counts = await check("2026-11-08T11:00");
    expect(counts).toEqual({ ...NONE, r2: 1 });
    const [row] = await firings(requestId);
    expect(row?.rule).toBe("r2");
    expect(row?.due_at).toEqual(at("2026-11-08T10:00"));
    // `fired_at` is the transaction time, a separate fact from the moment the threshold passed.
    expect(row?.fired_at).not.toEqual(row?.due_at);
  });
});

describe("the current settings (R7.7)", () => {
  it("fires a rule turned on after it became due, and never one that is off", async () => {
    const requestId = await open42();
    await configure({
      ...specSettings(),
      r1: { ...specSettings().r1, enabled: false },
      r2: { ...specSettings().r2, enabled: false },
    });
    expect(await check("2026-11-09T10:00")).toEqual(NONE);

    await configure({ ...specSettings(), r1: { ...specSettings().r1, enabled: false } });
    expect(await check("2026-11-09T10:01")).toEqual({ ...NONE, r2: 1 });
    expect((await firings(requestId)).map((row) => row.rule)).toEqual(["r2"]);
  });

  it("moves a rule that has not fired when its threshold changes", async () => {
    await open43();
    await configure({ ...specSettings(), r0: { ...specSettings().r0, days: 5 } });
    expect(await check("2026-11-04T09:01")).toEqual(NONE);
    expect(await check("2026-11-09T08:59")).toEqual(NONE);
    expect(await check("2026-11-09T09:00")).toEqual({ ...NONE, r0: 1 });
  });

  it("fires R1 for every request between its threshold and the deadline when R1 is turned on", async () => {
    await configure({ ...specSettings(), r1: { ...specSettings().r1, enabled: false } });
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const requestId = await submit(alNoor, "khalid", alNoor.priorities.high, `Contract ${i}`);
      await acceptRequest(alNoor, requestId);
      await setTimes(requestId, { submitted: "2026-11-01T09:00", accepted: "2026-11-01T10:00" });
      ids.push(requestId);
    }
    await clearNotifications();
    expect(await check("2026-11-05T09:00")).toEqual(NONE);

    await configure(specSettings());
    expect(await check("2026-11-05T09:01")).toEqual({ ...NONE, r1: 30 });
    expect((await inbox("faisal")).length).toBe(30);
  });

  it("leaves a firing alone when its rule is turned off afterwards", async () => {
    const requestId = await open43();
    await check("2026-11-04T09:01");
    await configure({ ...specSettings(), r0: { ...specSettings().r0, enabled: false } });
    expect(await check("2026-11-04T09:05")).toEqual(NONE);
    expect(await firings(requestId)).toHaveLength(1);
    expect(await notificationCount()).toBe(1);
  });
});

describe("Grace and Read-only (R7.9)", () => {
  it("fires as usual, and the recipients can still read their inbox", async () => {
    await open42();
    await pool.query(
      `update subscriptions set start_date = '2020-01-01', end_date = (now() at time zone 'Asia/Riyadh')::date - 60
       where tenant_id = $1`,
      [alNoor.tenantId],
    );
    try {
      expect(await check("2026-11-08T10:01")).toEqual({ ...NONE, r2: 1 });
      const res = await as("faisal").get("/notifications");
      expect(res.status).toBe(200);
      expect(res.body.data.map((entry: { kind: string }) => entry.kind)).toContain(
        "request.breached",
      );
    } finally {
      await pool.query(
        `update subscriptions set end_date = (now() at time zone 'Asia/Riyadh')::date + 365 where tenant_id = $1`,
        [alNoor.tenantId],
      );
    }
  });
});

describe("the audit entry (R7.10)", () => {
  it("records the rule, the moment due, the recipients, and the targets, as the system", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await check("2026-11-08T10:01");

    const [r1, r2] = await auditOf(requestId);
    expect(r1).toMatchObject({
      actor_type: "system",
      actor_id: null,
      resource_type: "request",
      request_id: RUN_ID,
    });
    expect(r2.details).toMatchObject({
      rule: "r2",
      dueAt: at("2026-11-08T10:00").toISOString(),
      noRecipients: false,
    });
    expect([...r2.details.recipients].sort()).toEqual(
      [id("faisal"), id("huda"), id("ahmed")].sort(),
    );
    const sortedTargets = (r2.details.targets as { userIds: string[] }[]).map((entry) => ({
      ...entry,
      userIds: [...entry.userIds].sort(),
    }));
    expect(sortedTargets).toEqual([
      {
        target: { builtin: "handler" },
        level: { kind: "person", party: "handler" },
        userIds: [id("faisal")],
      },
      {
        target: { builtin: "handler_unit_managers" },
        level: { kind: "managers", unitId: alNoor.units.legal, anchor: "handler" },
        userIds: [id("huda"), id("ahmed")].sort(),
      },
      {
        target: { builtin: "handler_department_managers" },
        level: { kind: "managers", unitId: alNoor.units.legal, anchor: "handler" },
        userIds: [id("huda"), id("ahmed")].sort(),
      },
    ]);
  });
});

describe("races with actions (section 5)", () => {
  it("does not fire on a request that completed after the check read it", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await clearNotifications();

    const counts = await check("2026-11-08T10:01", {
      afterScan: () => closeAsCompleted(requestId),
    });

    expect(counts).toEqual(NONE);
    expect((await firings(requestId)).map((row) => row.rule)).toEqual(["r1"]);
    expect(await notificationCount()).toBe(0);
  });

  it("does not fire R0 on a request accepted after the check read it", async () => {
    const requestId = await open43();
    const counts = await check("2026-11-04T09:00:20", {
      afterScan: () => acceptRequest(alNoor, requestId),
    });
    expect(counts).toEqual(NONE);
    expect(await firings(requestId)).toEqual([]);
  });

  it("skips a request someone is acting on, and fires it on the next run", async () => {
    const requestId = await open42();
    await check("2026-11-04T16:00");
    await clearNotifications();

    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from requests where id = $1 for update", [requestId]);
      // Without the row lock the firing would queue behind the holder forever; bound the wait so that fails here.
      const hung = new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 4000));
      expect(await Promise.race([check("2026-11-08T10:01"), hung])).toEqual({
        ...NONE,
        skippedLocked: 1,
      });
      expect(await notificationCount()).toBe(0);
    } finally {
      await holder.query("commit");
      holder.release();
    }
    expect(await check("2026-11-08T10:02")).toEqual({ ...NONE, r2: 1 });
  });
});

describe("failures and limits (section 5)", () => {
  it("rolls a firing back whole when any part of it fails, and tries again on the next run", async () => {
    const requestId = await open42();
    await pool.query(
      `create function fail_escalation_audit() returns trigger language plpgsql as
       $$ begin raise exception 'audit refused'; end $$`,
    );
    await pool.query(
      `create trigger fail_escalation_audit before insert on audit_log for each row
       when (new.action = 'request.escalated') execute function fail_escalation_audit()`,
    );
    try {
      expect(await check("2026-11-08T10:01")).toEqual({ ...NONE, failed: 1 });
    } finally {
      await pool.query("drop trigger fail_escalation_audit on audit_log");
      await pool.query("drop function fail_escalation_audit()");
    }
    expect(await firings(requestId)).toEqual([]);
    expect(await notificationCount()).toBe(0);
    expect(
      capture.lines().find((line) => line.msg === "escalation check failed for the request"),
    ).toMatchObject({
      level: 50,
      tenantId: alNoor.tenantId,
      requestId,
    });

    expect(await check("2026-11-08T10:02")).toEqual({ ...NONE, r2: 1 });
  });

  it("logs one tenant's failure with the tenant and keeps checking the others", async () => {
    const broken = await open42(rashid, "Al-Rashid contract");
    const healthy = await open42(alNoor, "Al-Noor contract");
    const original = (
      await pool.query<{ week: unknown }>("select week from working_hours where tenant_id = $1", [
        rashid.tenantId,
      ])
    ).rows[0]?.week;
    // No working day at all: the next-working-day search gives up (T33).
    await pool.query(
      `update working_hours set week = jsonb_set(week, '{days}', '{"sun":"off","mon":"off","tue":"off","wed":"off","thu":"off","fri":"off","sat":"off"}')
       where tenant_id = $1`,
      [rashid.tenantId],
    );
    try {
      expect(await check("2026-11-08T10:01")).toEqual({ ...NONE, r2: 1, failed: 1 });
    } finally {
      await pool.query("update working_hours set week = $2 where tenant_id = $1", [
        rashid.tenantId,
        JSON.stringify(original),
      ]);
    }
    expect(await firings(healthy)).toHaveLength(1);
    expect(await firings(broken)).toEqual([]);
    expect(
      capture.lines().find((line) => String(line.msg).startsWith("escalation check failed")),
    ).toMatchObject({
      level: 50,
      tenantId: rashid.tenantId,
    });
  });

  it("notifies only inside the request's own tenant", async () => {
    await open42(rashid, "Al-Rashid contract");
    await check("2026-11-08T10:01");
    expect(await told("request.breached")).toEqual([]);
    const { rows } = await pool.query<{ tenant_id: string }>(
      "select distinct tenant_id from notifications where kind = 'request.breached'",
    );
    expect(rows.map((row) => row.tenant_id)).toEqual([rashid.tenantId]);
  });

  it("stops starting firings when the time budget is spent, leaving the rest for the next run", async () => {
    const requestId = await open42();
    expect(await check("2026-11-08T10:01", { budgetMs: 0 })).toEqual(NONE);
    expect(await firings(requestId)).toEqual([]);
    expect(await check("2026-11-08T10:02")).toEqual({ ...NONE, r2: 1 });
  });

  it("stops starting firings when the signal is aborted", async () => {
    await open42();
    const abort = new AbortController();
    abort.abort();
    expect(await check("2026-11-08T10:01", { signal: abort.signal })).toEqual(NONE);
    expect(await notificationCount()).toBe(0);
  });
});
