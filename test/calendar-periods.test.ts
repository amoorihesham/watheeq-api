import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import {
  DEFAULT_WEEK,
  hijriToGregorian,
  toHijri,
  type WeekShapeType,
  weekView,
} from "../src/modules/calendar/index.js";
import { addDays } from "../src/modules/subscriptions/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let today = "";
let alNoor = "";
let sara = "";
let huda = "";
let rashid = "";
let counter = 0;

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
  delete: (path: string) => request(app).delete(path).set("Cookie", accessCookie(access)),
});

const monthDay = (date: string) => ({
  month: Number(date.slice(5, 7)),
  day: Number(date.slice(8, 10)),
});
const yearOf = (date: string) => Number(date.slice(0, 4));
const nextName = (prefix: string) => `${prefix} ${++counter}`;

// A season's hours as the API sends and returns them.
const ramadanHours = weekView({
  start: "10:00",
  end: "15:00",
  days: Object.fromEntries(
    Object.keys(DEFAULT_WEEK.days).map((d) => [d, "default"]),
  ) as WeekShapeType["days"],
});

/** A recurring Gregorian holiday whose current occurrence began yesterday and ends in two days. */
async function seedBegunHoliday(name = nextName("Begun")): Promise<string> {
  const start = monthDay(addDays(today, -1));
  const end = monthDay(addDays(today, 2));
  const { rows } = await pool.query(
    `insert into calendar_periods (tenant_id, kind, name, recurrence, start_month, start_day, end_month, end_day,
       valid_from)
     values ($1, 'holiday', $2, 'gregorian', $3, $4, $5, $6, '2020-01-01') returning id`,
    [alNoor, name, start.month, start.day, end.month, end.day],
  );
  return rows[0].id;
}

const periodAudit = (resourceId: string) =>
  pool
    .query(
      "select action, details from audit_log where resource_type = 'calendar_period' and resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

const dayOf = async (date: string) =>
  (await as(sara).get(`/calendar/days?from=${date}&to=${date}`)).body.data.days[0];

async function periodsWithEnded() {
  return (await as(sara).get("/calendar?includeEnded=true")).body.data.periods as {
    id: string;
    name: string;
    validUntil: string | null;
    replacesId: string | null;
    overrides: object[];
  }[];
}

beforeAll(async () => {
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
  const passwordHash = await hashPassword(PASSWORD);
  ({ id: alNoor } = await seedSubscribedTenant(pool, "cp-al-noor", [
    { email: "sara@cp-alnoor.test", passwordHash },
  ]));
  await seedSubscribedTenant(pool, "cp-al-rashid", [
    { email: "admin@cp-alrashid.test", passwordHash },
  ]);
  sara = (await login(app, "sara@cp-alnoor.test", PASSWORD)).access;
  rashid = (await login(app, "admin@cp-alrashid.test", PASSWORD)).access;
  const viewer = await seedRole(pool, alNoor, {
    name: "Head of Legal",
    permissions: [{ key: "calendar.view", scope: "organization" }],
  });
  const hudaId = await seedUser(pool, { email: "huda@cp-alnoor.test", passwordHash });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    alNoor,
    hudaId,
    viewer,
  ]);
  huda = (await login(app, "huda@cp-alnoor.test", PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("creating periods (R4.4, R4.5)", () => {
  it("adds a one-off holiday, shown in the day view and audited", async () => {
    const startDate = addDays(today, 3);
    const endDate = addDays(today, 4);
    const res = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: "Office move",
      recurrence: "once",
      startDate,
      endDate,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      kind: "holiday",
      name: "Office move",
      recurrence: "once",
      startDate,
      endDate,
      start: null,
      end: null,
      validFrom: null,
      validUntil: null,
      overrides: [],
      week: null,
      rank: null,
      replacesId: null,
      next: { startDate, endDate },
    });
    expect(await dayOf(startDate)).toMatchObject({
      working: false,
      holidays: [{ name: "Office move" }],
    });
    expect((await periodAudit(res.body.data.id))[0]).toEqual({
      action: "calendar.period_created",
      details: expect.objectContaining({
        name: "Office move",
        startDate,
        endDate,
        validFrom: null,
      }),
    });
  });

  it("adds a Hijri holiday from tomorrow, placed by Umm al-Qura", async () => {
    const res = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: "Eid al-Fitr",
      recurrence: "hijri",
      start: { month: 10, day: 1 },
      end: { month: 10, day: 4 },
    });
    expect(res.status).toBe(201);
    const year = toHijri(today).year;
    const thisYear = hijriToGregorian(year, 10, 1) ?? "";
    const firstDay = thisYear > today ? thisYear : (hijriToGregorian(year + 1, 10, 1) ?? "");
    expect(res.body.data).toMatchObject({
      validFrom: addDays(today, 1),
      validUntil: null,
      overrides: [],
      next: { startDate: firstDay, endDate: addDays(firstDay, 3) },
    });
    expect((await dayOf(firstDay)).holidays).toEqual([
      { id: res.body.data.id, name: "Eid al-Fitr" },
    ]);
  });

  it("adds seasons with distinct ranks only", async () => {
    const ramadan = {
      kind: "season",
      name: "Ramadan hours",
      recurrence: "hijri",
      start: { month: 9, day: 1 },
      end: { month: 9, day: 30 },
      week: ramadanHours,
      rank: 10,
    };
    const res = await as(sara).post("/calendar/periods", ramadan);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "season", rank: 10, week: ramadanHours });
    const clash = await as(sara).post("/calendar/periods", { ...ramadan, name: "Exam season" });
    expect(clash.status).toBe(400);
    expect(clash.body.error.details).toEqual([{ path: "rank", code: "rank_taken" }]);
    expect(
      (await as(sara).post("/calendar/periods", { ...ramadan, name: "Exam season", rank: 5 }))
        .status,
    ).toBe(201);
  });

  it("validates the definition", async () => {
    const once = {
      kind: "holiday",
      name: "x",
      recurrence: "once",
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
    };
    const yearly = { kind: "holiday", name: "x", recurrence: "gregorian" };
    const cases: [object, object[]][] = [
      [{ ...once, endDate: undefined }, [{ path: "endDate", code: "required" }]],
      [{ ...once, week: ramadanHours }, [{ path: "week", code: "not_allowed" }]],
      [
        { ...once, kind: "season" },
        [
          { path: "week", code: "required" },
          { path: "rank", code: "required" },
        ],
      ],
      [
        { ...yearly, start: { month: 1, day: 1 }, end: { month: 1, day: 1 }, startDate: today },
        [{ path: "startDate", code: "not_allowed" }],
      ],
      [{ ...once, endDate: addDays(today, 4) }, [{ path: "endDate", code: "end_before_start" }]],
      [{ ...once, endDate: addDays(today, 35) }, [{ path: "endDate", code: "period_too_long" }]],
      [
        { ...yearly, start: { month: 2, day: 30 }, end: { month: 3, day: 1 } },
        [{ path: "start.day", code: "invalid_day" }],
      ],
      [
        {
          ...yearly,
          recurrence: "hijri",
          start: { month: 9, day: 31 },
          end: { month: 9, day: 31 },
        },
        [
          { path: "start.day", code: "invalid_day" },
          { path: "end.day", code: "invalid_day" },
        ],
      ],
      [
        { ...yearly, start: { month: 12, day: 20 }, end: { month: 1, day: 25 } },
        [{ path: "end", code: "period_too_long" }],
      ],
      [
        {
          ...yearly,
          kind: "season",
          start: { month: 1, day: 1 },
          end: { month: 7, day: 4 },
          week: ramadanHours,
          rank: 50,
        },
        [{ path: "end", code: "period_too_long" }],
      ],
      [{ ...once, color: "green" }, [{ path: "color", code: "unknown_field" }]],
      [
        { ...once, startDate: addDays(today, 1827), endDate: addDays(today, 1827) },
        [{ path: "startDate", code: "too_far_ahead" }],
      ],
    ];
    for (const [body, details] of cases) {
      const res = await as(sara).post("/calendar/periods", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.details).toEqual(details);
    }
    // 29 February is a valid yearly date; it falls on the 28th in other years.
    const leap = await as(sara).post("/calendar/periods", {
      ...yearly,
      name: "Leap day",
      start: { month: 2, day: 29 },
      end: { month: 2, day: 29 },
    });
    expect(leap.status).toBe(201);
  });

  it("refuses a one-off period starting today or earlier (Q10)", async () => {
    for (const startDate of [today, addDays(today, -2)]) {
      const res = await as(sara).post("/calendar/periods", {
        kind: "holiday",
        name: "Too late",
        recurrence: "once",
        startDate,
        endDate: addDays(today, 1),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CALENDAR_DATE_LOCKED");
    }
  });
});

describe("editing and deleting periods (R4.8, P4.8)", () => {
  async function createOnce(offset = 10) {
    const res = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: nextName("Once"),
      recurrence: "once",
      startDate: addDays(today, offset),
      endDate: addDays(today, offset),
    });
    return res.body.data.id as string;
  }

  it("edits a future one-off holiday in place, and audits only real changes", async () => {
    const id = await createOnce();
    const res = await as(sara).patch(`/calendar/periods/${id}`, {
      name: "Moved office move",
      endDate: addDays(today, 11),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      name: "Moved office move",
      endDate: addDays(today, 11),
    });
    expect(
      (await as(sara).patch(`/calendar/periods/${id}`, { name: "Moved office move" })).status,
    ).toBe(200);
    const audit = await periodAudit(id);
    expect(audit.map((row) => row.action)).toEqual([
      "calendar.period_created",
      "calendar.period_updated",
    ]);
    expect(audit[1].details).toMatchObject({
      before: { endDate: addDays(today, 10) },
      after: { name: "Moved office move", endDate: addDays(today, 11) },
      replacedId: null,
    });
  });

  it("refuses to edit or delete a one-off holiday that has begun, or to move one into the past", async () => {
    const { rows } = await pool.query(
      `insert into calendar_periods (tenant_id, kind, name, recurrence, start_date, end_date)
       values ($1, 'holiday', 'Started', 'once', $2, $3) returning id`,
      [alNoor, addDays(today, -1), addDays(today, 1)],
    );
    const started = rows[0].id;
    expect((await as(sara).patch(`/calendar/periods/${started}`, { name: "x" })).status).toBe(409);
    expect((await as(sara).delete(`/calendar/periods/${started}`)).status).toBe(409);
    const future = await createOnce();
    const res = await as(sara).patch(`/calendar/periods/${future}`, { startDate: today });
    expect(res.body.error.code).toBe("CALENDAR_DATE_LOCKED");
  });

  it("edits a recurring period in place while none of its occurrences has begun", async () => {
    const created = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: "National Day",
      recurrence: "gregorian",
      start: { month: 9, day: 23 },
      end: { month: 9, day: 23 },
    });
    const id = created.body.data.id;
    const res = await as(sara).patch(`/calendar/periods/${id}`, { end: { month: 9, day: 24 } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, validFrom: addDays(today, 1), replacesId: null });
  });

  it("never lets an in-place edit reach back before tomorrow", async () => {
    // Created a month ago for a date three weeks ahead: nothing has begun, so the edit is in place.
    const ahead = monthDay(addDays(today, 20));
    const { rows } = await pool.query(
      `insert into calendar_periods (tenant_id, kind, name, recurrence, start_month, start_day, end_month,
         end_day, valid_from)
       values ($1, 'holiday', 'Late rule', 'gregorian', $2, $3, $2, $3, $4) returning id`,
      [alNoor, ahead.month, ahead.day, addDays(today, -30)],
    );
    const id = rows[0].id;
    const res = await as(sara).patch(`/calendar/periods/${id}`, {
      start: monthDay(addDays(today, -5)),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, validFrom: addDays(today, 1) });
    for (const date of [addDays(today, -5), today, addDays(today, 1)]) {
      const ids = (await dayOf(date)).holidays.map((h: { id: string }) => h.id);
      expect(ids, date).not.toContain(id);
    }
  });

  it("ends a begun recurring period today and replaces it from tomorrow, moving later adjustments", async () => {
    const id = await seedBegunHoliday();
    const nextYear = yearOf(today) + 1;
    const lastYear = yearOf(today) - 1;
    await pool.query(
      "insert into calendar_period_overrides (tenant_id, period_id, year, action) values ($1, $2, $3, 'skip'), ($1, $2, $4, 'skip')",
      [alNoor, id, nextYear, lastYear],
    );
    const end = monthDay(addDays(today, 3));
    const res = await as(sara).patch(`/calendar/periods/${id}`, { end });
    expect(res.status).toBe(200);
    const replacement = res.body.data;
    expect(replacement.id).not.toBe(id);
    expect(replacement).toMatchObject({
      replacesId: id,
      validFrom: addDays(today, 1),
      validUntil: null,
      end,
      overrides: [{ year: nextYear, action: "skip" }],
    });

    const old = (await periodsWithEnded()).find((p) => p.id === id);
    expect(old).toMatchObject({
      validUntil: today,
      overrides: [{ year: lastYear, action: "skip" }],
    });
    // The occurrence that began keeps its definition: it still ends in two days, not three.
    const holidayIds = async (date: string) =>
      (await dayOf(date)).holidays.map((h: { id: string }) => h.id);
    expect(await holidayIds(today)).toContain(id);
    expect(await holidayIds(today)).not.toContain(replacement.id);
    expect(await holidayIds(addDays(today, 2))).toContain(id);
    expect(await holidayIds(addDays(today, 3))).not.toContain(id);
    expect(await holidayIds(addDays(today, 3))).not.toContain(replacement.id);
    // Next year is skipped (the moved adjustment); the year after follows the new definition.
    const inTwoYears = (date: string) => `${yearOf(date) + 2}${date.slice(4)}`;
    expect(await holidayIds(inTwoYears(addDays(today, 3)))).toContain(replacement.id);
    expect(await holidayIds(inTwoYears(today))).toContain(replacement.id);
    expect(
      (await as(sara).get("/calendar")).body.data.periods.map((p: { id: string }) => p.id),
    ).not.toContain(id);

    expect(await periodAudit(replacement.id)).toEqual([
      {
        action: "calendar.period_updated",
        details: expect.objectContaining({
          replacedId: id,
          after: expect.objectContaining({ end }),
        }),
      },
    ]);
    const ended = await as(sara).patch(`/calendar/periods/${id}`, { name: "again" });
    expect(ended.status).toBe(409);
    expect(ended.body.error.code).toBe("CALENDAR_PERIOD_ENDED");
    expect((await as(sara).delete(`/calendar/periods/${id}`)).body.error.code).toBe(
      "CALENDAR_PERIOD_ENDED",
    );
  });

  it("refuses to change a period's kind or recurrence", async () => {
    const id = await createOnce();
    const res = await as(sara).patch(`/calendar/periods/${id}`, { kind: "season" });
    expect(res.body.error.details).toEqual([
      { path: "kind", code: "unknown_field" },
      { path: "", code: "no_fields" },
    ]);
  });

  it("removes a period that has not begun, and ends one that has", async () => {
    const future = await createOnce();
    expect((await as(sara).delete(`/calendar/periods/${future}`)).status).toBe(204);
    expect((await periodsWithEnded()).map((p) => p.id)).not.toContain(future);

    const begun = await seedBegunHoliday();
    await pool.query(
      "insert into calendar_period_overrides (tenant_id, period_id, year, action) values ($1, $2, $3, 'skip')",
      [alNoor, begun, yearOf(today) + 1],
    );
    expect((await as(sara).delete(`/calendar/periods/${begun}`)).status).toBe(204);
    expect((await periodsWithEnded()).find((p) => p.id === begun)).toMatchObject({
      validUntil: today,
      overrides: [],
    });
    expect((await dayOf(addDays(today, 1))).holidays.map((h: { id: string }) => h.id)).toContain(
      begun,
    );
    expect((await periodAudit(begun)).at(-1)).toMatchObject({
      action: "calendar.period_deleted",
      details: { ended: true },
    });
  });
});

describe("one-year adjustments (R4.7)", () => {
  let eid = "";
  let year = 0;
  let firstDay = "";

  beforeAll(async () => {
    const res = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: nextName("Eid"),
      recurrence: "hijri",
      start: { month: 12, day: 10 },
      end: { month: 12, day: 13 },
    });
    eid = res.body.data.id;
    firstDay = res.body.data.next.startDate;
    year = toHijri(firstDay).year;
  });

  it("moves one year's occurrence and returns it to the rule", async () => {
    const moved = {
      action: "move",
      startDate: addDays(firstDay, 1),
      endDate: addDays(firstDay, 4),
    };
    const res = await as(sara).put(`/calendar/periods/${eid}/overrides/${year}`, moved);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      overrides: [{ year, ...moved }],
      next: { startDate: moved.startDate, endDate: moved.endDate },
    });
    expect((await dayOf(firstDay)).holidays).toEqual([]);
    expect((await dayOf(moved.endDate)).holidays.map((h: { id: string }) => h.id)).toEqual([eid]);
    expect((await as(sara).put(`/calendar/periods/${eid}/overrides/${year}`, moved)).status).toBe(
      200,
    );

    expect((await as(sara).delete(`/calendar/periods/${eid}/overrides/${year}`)).status).toBe(204);
    expect((await dayOf(firstDay)).holidays.map((h: { id: string }) => h.id)).toEqual([eid]);
    expect((await periodAudit(eid)).map((row) => row.action)).toEqual([
      "calendar.period_created",
      "calendar.override_set",
      "calendar.override_deleted",
    ]);
    expect((await as(sara).delete(`/calendar/periods/${eid}/overrides/${year}`)).status).toBe(404);
  });

  it("skips one year's occurrence", async () => {
    const res = await as(sara).put(`/calendar/periods/${eid}/overrides/${year}`, {
      action: "skip",
    });
    expect(res.body.data.overrides).toEqual([
      { year, action: "skip", startDate: null, endDate: null },
    ]);
    expect((await dayOf(firstDay)).holidays).toEqual([]);
    await as(sara).delete(`/calendar/periods/${eid}/overrides/${year}`);
  });

  it("validates the adjustment", async () => {
    const once = await as(sara).post("/calendar/periods", {
      kind: "holiday",
      name: nextName("Once"),
      recurrence: "once",
      startDate: addDays(today, 8),
      endDate: addDays(today, 8),
    });
    const cases: [string, object, number, object][] = [
      [
        `${once.body.data.id}/overrides/2027`,
        { action: "skip" },
        400,
        [{ path: "periodId", code: "not_recurring" }],
      ],
      [
        `${eid}/overrides/${year - 5}`,
        { action: "skip" },
        400,
        [{ path: "year", code: "no_occurrence" }],
      ],
      [`${eid}/overrides/next`, { action: "skip" }, 400, [{ path: "year", code: "invalid_type" }]],
      [
        `${eid}/overrides/${year}`,
        { action: "move", startDate: addDays(firstDay, 2), endDate: firstDay },
        400,
        [{ path: "endDate", code: "end_before_start" }],
      ],
      [
        `${eid}/overrides/${year}`,
        { action: "move", startDate: firstDay, endDate: addDays(firstDay, 30) },
        400,
        [{ path: "endDate", code: "period_too_long" }],
      ],
      [
        `${eid}/overrides/${year}`,
        { action: "move", startDate: today, endDate: addDays(today, 1) },
        409,
        { code: "CALENDAR_DATE_LOCKED" },
      ],
      [
        `${eid}/overrides/${year}`,
        { action: "pause" },
        400,
        [{ path: "action", code: "invalid_union" }],
      ],
    ];
    for (const [path, body, status, expected] of cases) {
      const res = await as(sara).put(`/calendar/periods/${path}`, body);
      expect(res.status, path).toBe(status);
      if (status === 400) {
        expect(res.body.error.details).toEqual(expected);
      } else {
        expect(res.body.error).toMatchObject(expected);
      }
    }
  });

  it("refuses to adjust an occurrence that has begun", async () => {
    const begun = await seedBegunHoliday();
    const res = await as(sara).put(
      `/calendar/periods/${begun}/overrides/${yearOf(addDays(today, -1))}`,
      { action: "skip" },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CALENDAR_DATE_LOCKED");
  });
});

describe("listing (R4.11)", () => {
  it("leaves out ended versions and one-off periods already over unless asked", async () => {
    const { rows } = await pool.query(
      `insert into calendar_periods (tenant_id, kind, name, recurrence, start_date, end_date)
       values ($1, 'holiday', 'Last week', 'once', $2, $2) returning id`,
      [alNoor, addDays(today, -7)],
    );
    const ids = (await as(sara).get("/calendar")).body.data.periods.map(
      (p: { id: string }) => p.id,
    );
    expect(ids).not.toContain(rows[0].id);
    expect((await periodsWithEnded()).map((p) => p.id)).toContain(rows[0].id);
  });
});

describe("concurrency (P4.10)", () => {
  it("makes an edit wait for a concurrent edit of the same period, then refuse the ended version", async () => {
    const id = await seedBegunHoliday();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `calendar:${alNoor}`,
      ]);
      await client.query("update calendar_periods set valid_until = $2 where id = $1", [id, today]);
      const edit = as(sara)
        .patch(`/calendar/periods/${id}`, { name: "Concurrent" })
        .then((res) => res);
      for (let attempt = 0; attempt < 200; attempt++) {
        const { rows } = await pool.query(
          "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and (query ilike '%pg_advisory_xact_lock%' or query ilike '%calendar_periods%')",
        );
        if (rows[0].waiting > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query("commit");
      const res = await edit;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CALENDAR_PERIOD_ENDED");
    } finally {
      client.release();
    }
    expect((await periodsWithEnded()).filter((p) => p.replacesId === id)).toEqual([]);
  });
});

describe("access (R4.12-R4.14)", () => {
  it("lets only calendar.manage change periods", async () => {
    const res = await as(huda).post("/calendar/periods", {
      kind: "holiday",
      name: "x",
      recurrence: "once",
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
    });
    expect(res.status).toBe(403);
  });

  it("keeps each tenant's periods to itself", async () => {
    const id = await seedBegunHoliday();
    expect((await as(rashid).patch(`/calendar/periods/${id}`, { name: "x" })).status).toBe(404);
    expect((await as(rashid).delete(`/calendar/periods/${id}`)).status).toBe(404);
    expect(
      (await as(rashid).put(`/calendar/periods/${id}/overrides/2030`, { action: "skip" })).status,
    ).toBe(404);
    expect((await as(rashid).get("/calendar")).body.data.periods).toEqual([]);
    expect((await as(sara).patch("/calendar/periods/not-a-uuid", { name: "x" })).status).toBe(404);
  });

  it("refuses changes in Read-only", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "cp-read-only", [
      { email: "admin@cp-read-only.test", passwordHash },
    ]);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const admin = (await login(app, "admin@cp-read-only.test", PASSWORD)).access;
    const res = await as(admin).post("/calendar/periods", {
      kind: "holiday",
      name: "x",
      recurrence: "once",
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
    });
    expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
  });
});
