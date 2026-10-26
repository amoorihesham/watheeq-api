import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { DEFAULT_WEEK } from "../src/modules/calendar/index.js";
import { addDays } from "../src/modules/subscriptions/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@cal-alnoor.test";
const HUDA = "huda@cal-alnoor.test";
const KHALID = "khalid@cal-alnoor.test";
const RASHID = "admin@cal-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let today = "";
let alNoor = "";
let alRashid = "";
let sara = "";
let huda = "";
let khalid = "";
let rashid = "";

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
  delete: (path: string) => request(app).delete(path).set("Cookie", accessCookie(access)),
});

const shortThursdays = {
  ...DEFAULT_WEEK,
  days: { ...DEFAULT_WEEK.days, thu: { start: "08:00", end: "13:00" } },
};

const hoursAudit = (tenantId: string, effectiveFrom: string) =>
  pool
    .query(
      "select action, actor_id, details from audit_log where tenant_id = $1 and resource_type = 'working_hours' and resource_id = $2 order by id",
      [tenantId, effectiveFrom],
    )
    .then((result) => result.rows);

/** The first date after `from` that falls on `weekday` (0 = Sunday). */
function nextWeekday(from: string, weekday: number): string {
  let date = addDays(from, 1);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== weekday) {
    date = addDays(date, 1);
  }
  return date;
}

async function memberWith(tenantId: string, email: string, roleId: string): Promise<string> {
  const id = await seedUser(pool, { email, passwordHash: await hashPassword(PASSWORD) });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    tenantId,
    id,
    roleId,
  ]);
  return (await login(app, email, PASSWORD)).access;
}

/** True once a calendar statement of this database waits for a lock: the advisory lock, or the row itself. */
async function waitUntilCalendarWriteWaits(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await pool.query(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and (query ilike '%pg_advisory_xact_lock%' or query ilike '%working_hours%')",
    );
    if (rows[0].waiting > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no statement became blocked");
}

beforeAll(async () => {
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
  const passwordHash = await hashPassword(PASSWORD);
  ({ id: alNoor } = await seedSubscribedTenant(pool, "cal-al-noor", [
    { email: SARA, passwordHash },
  ]));
  ({ id: alRashid } = await seedSubscribedTenant(pool, "cal-al-rashid", [
    { email: RASHID, passwordHash },
  ]));
  sara = (await login(app, SARA, PASSWORD)).access;
  rashid = (await login(app, RASHID, PASSWORD)).access;
  const viewer = await seedRole(pool, alNoor, {
    name: "Head of Legal",
    permissions: [{ key: "calendar.view", scope: "organization" }],
  });
  const employee = await seedRole(pool, alNoor, { name: "Employee" });
  huda = await memberWith(alNoor, HUDA, viewer);
  khalid = await memberWith(alNoor, KHALID, employee);
});

afterAll(async () => {
  await pool.end();
});

describe("a tenant's calendar (R4.1)", () => {
  it("starts with the default normal hours and nothing else", async () => {
    const res = await as(sara).get("/calendar");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { today, hours: [{ effectiveFrom: today, week: DEFAULT_WEEK }], periods: [] },
    });
  });

  it("is backfilled for tenants created before Phase 4, from their creation date, once", async () => {
    const { id } = await seedSubscribedTenant(pool, "cal-legacy", [
      { email: "admin@cal-legacy.test" },
    ]);
    await pool.query("delete from working_hours where tenant_id = $1", [id]);
    await pool.query(
      "update tenants set created_at = '2026-03-14T22:30:00Z' where id = $1", // 2026-03-15 in Riyadh
      [id],
    );
    const backfill = readFileSync("db/migrations/0007_calendar_backfill.sql", "utf8");
    await pool.query(backfill);
    await pool.query(backfill);
    const { rows } = await pool.query(
      "select effective_from::text, week from working_hours where tenant_id = $1",
      [id],
    );
    expect(rows).toEqual([{ effective_from: "2026-03-15", week: DEFAULT_WEEK }]);
  });
});

describe("normal hours (R4.2, R4.3, R4.8)", () => {
  it("adds a version from a future date, audited, without touching the days before it", async () => {
    const from = addDays(today, 10);
    const res = await as(sara).put(`/calendar/hours/${from}`, shortThursdays);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { effectiveFrom: from, week: shortThursdays } });

    const calendar = (await as(sara).get("/calendar")).body.data;
    expect(calendar.hours).toEqual([
      { effectiveFrom: today, week: DEFAULT_WEEK },
      { effectiveFrom: from, week: shortThursdays },
    ]);
    const before = nextWeekday(today, 4);
    const after = nextWeekday(from, 4);
    const days = (await as(sara).get(`/calendar/days?from=${today}&to=${after}`)).body.data.days;
    const thursday = (date: string) => days.find((d: { date: string }) => d.date === date);
    if (before < from) {
      expect(thursday(before)).toMatchObject({ working: true, start: "08:00", end: "16:00" });
    }
    expect(thursday(after)).toMatchObject({ working: true, start: "08:00", end: "13:00" });

    expect(await hoursAudit(alNoor, from)).toEqual([
      {
        action: "calendar.hours_set",
        actor_id: expect.any(String),
        details: { effectiveFrom: from, before: null, after: shortThursdays },
      },
    ]);
  });

  it("replaces a future version with before and after in the audit, and ignores a no-op", async () => {
    const from = addDays(today, 20);
    await as(sara).put(`/calendar/hours/${from}`, shortThursdays);
    const res = await as(sara).put(`/calendar/hours/${from}`, DEFAULT_WEEK);
    expect(res.status).toBe(200);
    expect((await as(sara).put(`/calendar/hours/${from}`, DEFAULT_WEEK)).status).toBe(200);
    expect((await hoursAudit(alNoor, from)).map((row) => row.details)).toEqual([
      { effectiveFrom: from, before: null, after: shortThursdays },
      { effectiveFrom: from, before: shortThursdays, after: DEFAULT_WEEK },
    ]);
  });

  it("deletes a future version, audited", async () => {
    const from = addDays(today, 30);
    await as(sara).put(`/calendar/hours/${from}`, shortThursdays);
    expect((await as(sara).delete(`/calendar/hours/${from}`)).status).toBe(204);
    const hours = (await as(sara).get("/calendar")).body.data.hours;
    expect(hours.map((v: { effectiveFrom: string }) => v.effectiveFrom)).not.toContain(from);
    expect((await hoursAudit(alNoor, from)).at(-1)).toMatchObject({
      action: "calendar.hours_deleted",
      details: { effectiveFrom: from, week: shortThursdays },
    });
    expect((await as(sara).delete(`/calendar/hours/${from}`)).status).toBe(404);
  });

  it.each([
    ["today", 0],
    ["yesterday", -1],
  ])("refuses to set hours from %s: the past is fixed (Q10)", async (_name, offset) => {
    const res = await as(sara).put(`/calendar/hours/${addDays(today, offset)}`, shortThursdays);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CALENDAR_DATE_LOCKED");
  });

  it("never deletes the version in force today", async () => {
    const res = await as(sara).delete(`/calendar/hours/${today}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CALENDAR_DATE_LOCKED");
  });

  it("validates the date and the week shape", async () => {
    const cases: [string, object, object[]][] = [
      [addDays(today, 1827), DEFAULT_WEEK, [{ path: "effectiveFrom", code: "too_far_ahead" }]],
      ["2027-02-30", DEFAULT_WEEK, [{ path: "effectiveFrom", code: "invalid_format" }]],
      ["soon", DEFAULT_WEEK, [{ path: "effectiveFrom", code: "invalid_format" }]],
      [
        addDays(today, 5),
        {
          ...DEFAULT_WEEK,
          days: Object.fromEntries(Object.keys(DEFAULT_WEEK.days).map((d) => [d, "off"])),
        },
        [{ path: "days", code: "no_working_day" }],
      ],
      [
        addDays(today, 5),
        { ...DEFAULT_WEEK, end: "07:00" },
        [{ path: "end", code: "end_before_start" }],
      ],
    ];
    for (const [date, week, details] of cases) {
      const res = await as(sara).put(`/calendar/hours/${date}`, week);
      expect(res.status, date).toBe(400);
      expect(res.body.error.details).toEqual(details);
    }
    expect(
      (await as(sara).put(`/calendar/hours/${addDays(today, 1826)}`, DEFAULT_WEEK)).status,
    ).toBe(200);
  });

  it("makes a change wait for a concurrent one, then audit it against what that one left (P4.10)", async () => {
    const from = addDays(today, 40);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `calendar:${alNoor}`,
      ]);
      await client.query(
        "insert into working_hours (tenant_id, effective_from, week) values ($1, $2, $3)",
        [alNoor, from, JSON.stringify(shortThursdays)],
      );
      const change = as(sara)
        .put(`/calendar/hours/${from}`, DEFAULT_WEEK)
        .then((res) => res);
      await waitUntilCalendarWriteWaits();
      await client.query("commit");
      expect((await change).status).toBe(200);
    } finally {
      client.release();
    }
    expect((await hoursAudit(alNoor, from)).map((row) => row.details)).toEqual([
      { effectiveFrom: from, before: shortThursdays, after: DEFAULT_WEEK },
    ]);
  });
});

describe("day view (R4.11)", () => {
  beforeAll(async () => {
    // Holidays and seasons are written through the API in step 4.3; here they are seeded directly.
    await pool.query(
      `insert into calendar_periods (tenant_id, kind, name, recurrence, start_month, start_day, end_month,
         end_day, week, rank, valid_from)
       values
         ($1, 'season', 'Ramadan hours', 'hijri', 9, 1, 9, 30, $2, 10, '2026-01-01'),
         ($1, 'holiday', 'Founding Day', 'gregorian', 2, 22, 2, 22, null, null, '2026-01-01'),
         ($1, 'holiday', 'Eid al-Fitr', 'hijri', 10, 1, 10, 4, null, null, '2026-01-01')`,
      [
        alRashid,
        JSON.stringify({
          start: "10:00",
          end: "15:00",
          days: Object.fromEntries(Object.keys(DEFAULT_WEEK.days).map((d) => [d, "default"])),
        }),
      ],
    );
  });

  it("shows Ramadan hours, Founding Day inside Ramadan, Eid, and the return to normal hours", async () => {
    const res = await as(rashid).get("/calendar/days?from=2027-02-20&to=2027-03-14");
    expect(res.status).toBe(200);
    const byDate = new Map(res.body.data.days.map((d: { date: string }) => [d.date, d]));
    expect(res.body.data.days).toHaveLength(23);
    expect(byDate.get("2027-02-21")).toEqual({
      date: "2027-02-21",
      hijriDate: { year: 1448, month: 9, day: 14 },
      working: true,
      start: "10:00",
      end: "15:00",
      holidays: [],
      season: { id: expect.any(String), name: "Ramadan hours" },
    });
    expect(byDate.get("2027-02-22")).toMatchObject({
      working: false,
      holidays: [{ name: "Founding Day" }],
      season: { name: "Ramadan hours" },
    });
    expect(byDate.get("2027-02-26")).toMatchObject({ working: false, holidays: [] }); // Friday
    for (const date of ["2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"]) {
      expect(byDate.get(date)).toMatchObject({
        working: false,
        holidays: [{ name: "Eid al-Fitr" }],
      });
    }
    expect(byDate.get("2027-03-14")).toEqual({
      date: "2027-03-14",
      hijriDate: { year: 1448, month: 10, day: 6 },
      working: true,
      start: "08:00",
      end: "16:00",
      holidays: [],
      season: null,
    });
  });

  it("answers the range with a day off as nulls and the view's from and to", async () => {
    const res = await as(rashid).get("/calendar/days?from=2027-02-22&to=2027-02-22");
    expect(res.body.data.from).toBe("2027-02-22");
    expect(res.body.data.to).toBe("2027-02-22");
    expect(res.body.data.days[0]).toMatchObject({ working: false, start: null, end: null });
  });

  it("lists the periods with their next occurrence", async () => {
    const year = Number(today.slice(0, 4)) + (today.slice(5) > "02-22" ? 1 : 0);
    const periods = (await as(rashid).get("/calendar")).body.data.periods;
    const next = Object.fromEntries(
      periods.map((p: { name: string; next: object }) => [p.name, p.next]),
    );
    expect(next["Founding Day"]).toEqual({ startDate: `${year}-02-22`, endDate: `${year}-02-22` });
    expect(Object.keys(next).sort()).toEqual(["Eid al-Fitr", "Founding Day", "Ramadan hours"]);
    expect(periods.find((p: { name: string }) => p.name === "Ramadan hours")).toMatchObject({
      kind: "season",
      recurrence: "hijri",
      start: { month: 9, day: 1 },
      end: { month: 9, day: 30 },
      rank: 10,
      validUntil: null,
      replacesId: null,
      overrides: [],
    });
  });

  it("validates the range", async () => {
    const cases: [string, object[]][] = [
      ["from=2027-03-14&to=2027-03-01", [{ path: "to", code: "end_before_start" }]],
      ["from=2027-01-01&to=2028-01-02", [{ path: "to", code: "range_too_long" }]],
      ["from=2027-01-01", [{ path: "to", code: "invalid_type" }]],
      ["from=2027-13-01&to=2027-01-02", [{ path: "from", code: "invalid_format" }]],
    ];
    for (const [query, details] of cases) {
      const res = await as(sara).get(`/calendar/days?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.details).toEqual(details);
    }
    // 366 days is the most (2028 is a leap year).
    const res = await as(sara).get("/calendar/days?from=2028-01-01&to=2028-12-31");
    expect(res.body.data.days).toHaveLength(366);
  });
});

describe("access (R4.12-R4.14)", () => {
  it("lets calendar.view read and only calendar.manage write", async () => {
    expect((await as(huda).get("/calendar")).status).toBe(200);
    expect((await as(huda).get(`/calendar/days?from=${today}&to=${today}`)).status).toBe(200);
    const write = await as(huda).put(`/calendar/hours/${addDays(today, 3)}`, DEFAULT_WEEK);
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("FORBIDDEN");
    expect((await as(huda).delete(`/calendar/hours/${addDays(today, 3)}`)).status).toBe(403);
    expect((await as(khalid).get("/calendar")).status).toBe(403);
  });

  it("refuses changes in Read-only and still shows the calendar", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "cal-read-only", [
      { email: "admin@cal-read-only.test", passwordHash },
    ]);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const admin = (await login(app, "admin@cal-read-only.test", PASSWORD)).access;
    const res = await as(admin).put(`/calendar/hours/${addDays(today, 3)}`, DEFAULT_WEEK);
    expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    expect((await as(admin).get("/calendar")).status).toBe(200);
  });

  it("keeps each tenant's calendar to itself", async () => {
    const from = addDays(today, 50);
    await as(sara).put(`/calendar/hours/${from}`, shortThursdays);
    const rashidHours = (await as(rashid).get("/calendar")).body.data.hours;
    expect(rashidHours).toEqual([{ effectiveFrom: today, week: DEFAULT_WEEK }]);
    expect((await as(rashid).delete(`/calendar/hours/${from}`)).status).toBe(404);
    expect((await as(sara).get("/calendar")).body.data.periods).toEqual([]);
  });
});
