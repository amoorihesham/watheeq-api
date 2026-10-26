import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { withTx } from "../src/db/tx.js";
import { createLogger } from "../src/logging/logger.js";
import { notify } from "../src/modules/notifications/index.js";
import {
  type AlNoorType,
  asUser,
  type PersonType,
  seedAlNoor,
  vendorAnswers,
} from "./helpers/al-noor.js";
import { testApp } from "./helpers/app.js";
import { hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, seedSubscribedTenant } from "./helpers/db.js";

// Phase 7 spec, R7.11, R7.15, and R7.19 (step 7.2): the inbox and `notify`.

const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger("silent"));

let alNoor: AlNoorType;
let rashid: { userId: string; token: string };
let requestId = "";

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const asRashid = () => asUser(app, rashid.token);
const failure = (res: { body: { error: { code: string; details?: unknown } } }) => res.body.error;

/** Inserts a notification with an exact time, so ordering does not depend on the clock. */
async function seed(
  person: PersonType,
  createdAt: string,
  options: { readAt?: string; id?: string; tenantId?: string; userId?: string } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into notifications (id, tenant_id, user_id, kind, data, created_at, read_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, 'request.breached', '{"number":"REQ-42-2026","title":"Gulf Supplies"}', $4, $5)
     returning id`,
    [
      options.id ?? null,
      options.tenantId ?? alNoor.tenantId,
      options.userId ?? alNoor.ids[person],
      createdAt,
      options.readAt ?? null,
    ],
  );
  return rows[0]?.id ?? "";
}

/** A notification of the other tenant's user, to prove no route reaches it. */
async function seedForRashid(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into notifications (tenant_id, user_id, kind, data)
     select tenant_id, user_id, 'request.breached', '{}' from tenant_members where user_id = $1
     returning id`,
    [rashid.userId],
  );
  return rows[0]?.id ?? "";
}

const idsInListOrder = async (person: PersonType) =>
  (
    await pool.query<{ id: string }>(
      "select id from notifications where user_id = $1 order by created_at desc, id desc",
      [alNoor.ids[person]],
    )
  ).rows.map((row) => row.id);

const unreadIds = async (person: PersonType) =>
  (
    await pool.query<{ id: string }>(
      "select id from notifications where user_id = $1 and read_at is null",
      [alNoor.ids[person]],
    )
  ).rows.map((row) => row.id);

const rowsOf = async (person: PersonType) =>
  (
    await pool.query<{ kind: string; request_id: string | null; data: unknown }>(
      "select kind, request_id, data from notifications where user_id = $1",
      [alNoor.ids[person]],
    )
  ).rows;

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, "ntf-al-noor");
  const hash = await hashPassword("correct horse battery staple");
  const tenant = await seedSubscribedTenant(pool, "ntf-al-rashid", [
    { email: "salem@ntf-al-rashid.test", passwordHash: hash },
  ]);
  rashid = {
    userId: tenant.userIds[0] ?? "",
    token: (await login(app, "salem@ntf-al-rashid.test", "correct horse battery staple")).access,
  };
  const submitted = await as("khalid").post("/requests", {
    serviceId: alNoor.serviceId,
    priorityId: alNoor.priorities.high,
    title: "Gulf Supplies contract",
    answers: vendorAnswers(alNoor),
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  requestId = submitted.body.request.id;
});

beforeEach(async () => {
  await pool.query("delete from notifications where tenant_id = $1 or user_id = $2", [
    alNoor.tenantId,
    rashid.userId,
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("notify (R7.11)", () => {
  const data = { number: "REQ-42-2026", title: "Gulf Supplies contract" };
  const ids = () => alNoor.ids;

  it("writes one row per recipient, none for the actor, once for a person named twice", async () => {
    await withTx(db, (tx) =>
      notify(tx, {
        tenantId: alNoor.tenantId,
        recipients: [ids().faisal, ids().huda, ids().faisal, ids().khalid],
        actorId: ids().khalid,
        kind: "request.accepted",
        requestId,
        data,
      }),
    );
    expect(await rowsOf("faisal")).toEqual([
      { kind: "request.accepted", request_id: requestId, data },
    ]);
    expect(await rowsOf("huda")).toHaveLength(1);
    expect(await rowsOf("khalid")).toHaveLength(0);
  });

  it("writes nothing when the actor is the only recipient, or nobody is named", async () => {
    await withTx(db, async (tx) => {
      await notify(tx, {
        tenantId: alNoor.tenantId,
        recipients: [ids().faisal],
        actorId: ids().faisal,
        kind: "request.stage_assigned",
        requestId,
        data,
      });
      await notify(tx, {
        tenantId: alNoor.tenantId,
        recipients: [],
        kind: "request.stage_assigned",
        requestId,
        data,
      });
    });
    const { rows } = await pool.query("select 1 from notifications where tenant_id = $1", [
      alNoor.tenantId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("skips an inactive member and a user of another tenant, and links no request when none is given", async () => {
    await pool.query("update users set is_active = false where id = $1", [ids().nora]);
    try {
      await withTx(db, (tx) =>
        notify(tx, {
          tenantId: alNoor.tenantId,
          recipients: [ids().nora, rashid.userId, ids().sara],
          kind: "subscription.ending_soon",
          data: { endDate: "2026-12-31" },
        }),
      );
    } finally {
      await pool.query("update users set is_active = true where id = $1", [ids().nora]);
    }
    expect(await rowsOf("nora")).toHaveLength(0);
    expect(await rowsOf("sara")).toEqual([
      { kind: "subscription.ending_soon", request_id: null, data: { endDate: "2026-12-31" } },
    ]);
    const rashidRows = await pool.query("select 1 from notifications where user_id = $1", [
      rashid.userId,
    ]);
    expect(rashidRows.rows).toHaveLength(0);
  });

  it("leaves no row when the transaction rolls back after notify", async () => {
    const attempt = withTx(db, async (tx) => {
      await notify(tx, {
        tenantId: alNoor.tenantId,
        recipients: [ids().khalid],
        actorId: ids().huda,
        kind: "request.accepted",
        requestId,
        data,
      });
      throw new Error("the accept fails after notifying");
    });
    await expect(attempt).rejects.toThrow("the accept fails after notifying");
    expect(await rowsOf("khalid")).toHaveLength(0);
  });
});

describe("GET /notifications (R7.15)", () => {
  it("lists the caller's notifications newest first, ties broken by ID, in the documented shape", async () => {
    const older = await seed("faisal", "2026-11-02T09:00:00Z");
    const [tieA, tieB] = [
      await seed("faisal", "2026-11-03T09:00:00Z"),
      await seed("faisal", "2026-11-03T09:00:00Z"),
    ];
    await seed("huda", "2026-11-04T09:00:00Z");

    const res = await as("faisal").get("/notifications");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const [first, second] = [tieA, tieB].sort().reverse();
    expect(res.body.notifications.map((n: { id: string }) => n.id)).toEqual([first, second, older]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.notifications[2]).toEqual({
      id: older,
      kind: "request.breached",
      request: null,
      data: { number: "REQ-42-2026", title: "Gulf Supplies" },
      createdAt: "2026-11-02T09:00:00.000Z",
      readAt: null,
    });
  });

  it("returns the request link as {id} when the notification has one", async () => {
    await withTx(db, (tx) =>
      notify(tx, {
        tenantId: alNoor.tenantId,
        recipients: [alNoor.ids.faisal],
        kind: "request.at_risk",
        requestId,
        data: { number: "REQ-1-2026", title: "t" },
      }),
    );
    const res = await as("faisal").get("/notifications");
    expect(res.body.notifications[0].request).toEqual({ id: requestId });
  });

  it("pages with before and hasMore, with no repeat or gap, even when times differ by microseconds", async () => {
    const times = [
      "2026-11-02T09:00:00.000100Z",
      "2026-11-02T09:00:00.000200Z",
      "2026-11-02T09:00:00.000300Z",
      "2026-11-02T09:00:00.000300Z",
      "2026-11-02T09:00:01Z",
    ];
    for (const time of times) {
      await seed("faisal", time);
    }
    const expected = await idsInListOrder("faisal");

    const seen: string[] = [];
    const flags: boolean[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await as("faisal").get(
        `/notifications?limit=2${before ? `&before=${before}` : ""}`,
      );
      expect(res.status).toBe(200);
      const ids = res.body.notifications.map((n: { id: string }) => n.id);
      seen.push(...ids);
      flags.push(res.body.hasMore);
      if (!res.body.hasMore) {
        break;
      }
      before = ids.at(-1);
    }
    expect(seen).toEqual(expected);
    expect(flags).toEqual([true, true, false]);
  });

  it("is not shifted by a notification that arrives while the user reads page one", async () => {
    for (let i = 1; i <= 3; i++) {
      await seed("faisal", `2026-11-02T09:0${i}:00Z`);
    }
    const pageOne = await as("faisal").get("/notifications?limit=2");
    await seed("faisal", "2026-11-02T09:09:00Z");
    const pageTwo = await as("faisal").get(
      `/notifications?limit=2&before=${pageOne.body.notifications[1].id}`,
    );
    const first = pageOne.body.notifications.map((n: { id: string }) => n.id);
    const second = pageTwo.body.notifications.map((n: { id: string }) => n.id);
    expect(new Set([...first, ...second]).size).toBe(3);
  });

  it("filters to unread, also with a cursor that is itself read", async () => {
    await seed("faisal", "2026-11-02T09:01:00Z", { readAt: "2026-11-02T10:00:00Z" });
    const unreadA = await seed("faisal", "2026-11-02T09:02:00Z");
    const readCursor = await seed("faisal", "2026-11-02T09:03:00Z", {
      readAt: "2026-11-02T10:00:00Z",
    });
    const unreadB = await seed("faisal", "2026-11-02T09:04:00Z");

    const unread = await as("faisal").get("/notifications?unread=true");
    expect(unread.body.notifications.map((n: { id: string }) => n.id)).toEqual([unreadB, unreadA]);
    const after = await as("faisal").get(`/notifications?unread=true&before=${readCursor}`);
    expect(after.body.notifications.map((n: { id: string }) => n.id)).toEqual([unreadA]);
  });

  it("rejects a before that is not the caller's own, with the same answer for another user's and a made-up ID", async () => {
    const hudas = await seed("huda", "2026-11-02T09:00:00Z");
    const rashidsId = await seedForRashid();

    for (const id of [hudas, rashidsId, "7f0c6a52-4d0e-4a43-9a52-4b1c9d2f6a11"]) {
      const res = await as("faisal").get(`/notifications?before=${id}`);
      expect(res.status).toBe(400);
      expect(failure(res)).toMatchObject({
        code: "VALIDATION_FAILED",
        details: [{ path: "before", code: "unknown_notification" }],
      });
    }
  });

  it("validates limit and before, and ignores unrelated query parameters", async () => {
    await seed("faisal", "2026-11-02T09:00:00Z");
    for (const query of ["limit=0", "limit=101", "limit=abc", "before=nope", "unread=false"]) {
      const res = await as("faisal").get(`/notifications?${query}`);
      expect(res.status, query).toBe(400);
    }
    const ok = await as("faisal").get("/notifications?limit=100&utm_source=mail");
    expect(ok.status).toBe(200);
    expect(ok.body.notifications).toHaveLength(1);
  });

  it("defaults the page to 25", async () => {
    for (let i = 0; i < 26; i++) {
      await seed("faisal", new Date(Date.UTC(2026, 10, 2, 9, i)).toISOString());
    }
    const res = await as("faisal").get("/notifications");
    expect(res.body.notifications).toHaveLength(25);
    expect(res.body.hasMore).toBe(true);
  });

  it("requires a signed-in user", async () => {
    const anonymous = await asUser(app, "not-a-token").get("/notifications");
    expect(anonymous.status).toBe(401);
  });
});

describe("GET /notifications/unread-count", () => {
  it("counts only the caller's unread notifications", async () => {
    await seed("faisal", "2026-11-02T09:01:00Z");
    await seed("faisal", "2026-11-02T09:02:00Z");
    await seed("faisal", "2026-11-02T09:03:00Z", { readAt: "2026-11-02T10:00:00Z" });
    await seed("huda", "2026-11-02T09:04:00Z");

    const faisal = await as("faisal").get("/notifications/unread-count");
    expect(faisal.status).toBe(200);
    expect(faisal.body).toEqual({ count: 2 });
    expect((await as("nora").get("/notifications/unread-count")).body).toEqual({ count: 0 });
  });
});

describe("POST /notifications/:id/read", () => {
  it("marks one read, keeps the first read time, and answers 204 again", async () => {
    const id = await seed("faisal", "2026-11-02T09:00:00Z");
    const other = await seed("faisal", "2026-11-02T09:01:00Z");

    expect((await as("faisal").post(`/notifications/${id}/read`)).status).toBe(204);
    const first = await pool.query("select read_at from notifications where id = $1", [id]);
    expect(first.rows[0].read_at).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await as("faisal").post(`/notifications/${id}/read`)).status).toBe(204);
    const second = await pool.query("select read_at from notifications where id = $1", [id]);
    expect(second.rows[0].read_at).toEqual(first.rows[0].read_at);
    expect(await unreadIds("faisal")).toEqual([other]);
  });

  it("answers 404 for another user's, another tenant's, an unknown, and a malformed ID, and changes nothing", async () => {
    const hudas = await seed("huda", "2026-11-02T09:00:00Z");
    const rashidsId = await seedForRashid();

    for (const id of [hudas, rashidsId, "7f0c6a52-4d0e-4a43-9a52-4b1c9d2f6a11", "nope"]) {
      const res = await as("faisal").post(`/notifications/${id}/read`);
      expect(res.status, String(id)).toBe(404);
    }
    const untouched = await pool.query(
      "select 1 from notifications where read_at is not null and tenant_id = $1",
      [alNoor.tenantId],
    );
    expect(untouched.rows).toHaveLength(0);

    const hers = await asRashid().post(`/notifications/${hudas}/read`);
    expect(hers.status).toBe(404);
  });
});

describe("POST /notifications/read-all", () => {
  it("marks the caller's unread notifications up to upTo, and leaves a newer one unread", async () => {
    await seed("faisal", "2026-11-02T09:01:00Z");
    await seed("faisal", "2026-11-02T09:02:00Z");
    const seen = await seed("faisal", "2026-11-02T09:03:00Z");
    const arrivedLater = await seed("faisal", "2026-11-02T09:03:03Z");
    const alreadyRead = await seed("faisal", "2026-11-02T09:00:00Z", {
      readAt: "2026-11-02T09:30:00Z",
    });
    const hudas = await seed("huda", "2026-11-02T09:01:00Z");

    const res = await as("faisal").post("/notifications/read-all", { upTo: seen });
    expect(res.status).toBe(204);
    expect(await unreadIds("faisal")).toEqual([arrivedLater]);
    expect(await unreadIds("huda")).toEqual([hudas]);
    const kept = await pool.query("select read_at from notifications where id = $1", [alreadyRead]);
    expect(kept.rows[0].read_at.toISOString()).toBe("2026-11-02T09:30:00.000Z");
  });

  it("breaks a tie on equal times by ID, as the list does", async () => {
    const pair = [
      await seed("faisal", "2026-11-02T09:00:00Z"),
      await seed("faisal", "2026-11-02T09:00:00Z"),
    ].sort();
    const [lower, higher] = pair as [string, string];
    // On equal times the list puts the higher ID first, so it counts as the newer one.
    expect((await as("faisal").post("/notifications/read-all", { upTo: lower })).status).toBe(204);
    expect(await unreadIds("faisal")).toEqual([higher]);

    await pool.query("update notifications set read_at = null where tenant_id = $1", [
      alNoor.tenantId,
    ]);
    expect((await as("faisal").post("/notifications/read-all", { upTo: higher })).status).toBe(204);
    expect(await unreadIds("faisal")).toEqual([]);
  });

  it("answers 400 unknown_notification at upTo for another user's, another tenant's, and a made-up ID", async () => {
    const hudas = await seed("huda", "2026-11-02T09:00:00Z");
    const own = await seed("faisal", "2026-11-02T09:00:00Z");
    const rashidsId = await seedForRashid();

    for (const id of [hudas, rashidsId, "7f0c6a52-4d0e-4a43-9a52-4b1c9d2f6a11"]) {
      const res = await as("faisal").post("/notifications/read-all", { upTo: id });
      expect(res.status).toBe(400);
      expect(failure(res)).toMatchObject({
        code: "VALIDATION_FAILED",
        details: [{ path: "upTo", code: "unknown_notification" }],
      });
    }
    expect(await unreadIds("faisal")).toEqual([own]);
    expect(await unreadIds("huda")).toEqual([hudas]);
  });

  it("rejects an unknown body field, a missing upTo, and a malformed upTo", async () => {
    const own = await seed("faisal", "2026-11-02T09:00:00Z");
    const extra = await as("faisal").post("/notifications/read-all", { upTo: own, all: true });
    expect(extra.status).toBe(400);
    expect(failure(extra).details).toEqual([{ path: "all", code: "unknown_field" }]);

    const missing = await as("faisal").post("/notifications/read-all", {});
    expect(missing.status).toBe(400);
    expect(failure(missing).details).toEqual([{ path: "upTo", code: "invalid_type" }]);

    const malformed = await as("faisal").post("/notifications/read-all", { upTo: "nope" });
    expect(malformed.status).toBe(400);
    expect(await unreadIds("faisal")).toEqual([own]);
  });
});

describe("tenant isolation (R7.19)", () => {
  it("shows another tenant's user only their own notifications", async () => {
    await seed("faisal", "2026-11-02T09:00:00Z");
    await seedForRashid();
    const hers = await asRashid().get("/notifications");
    expect(hers.body.notifications).toHaveLength(1);
    expect((await asRashid().get("/notifications/unread-count")).body).toEqual({ count: 1 });
  });
});

describe("in every subscription state (R7.15, P7.7)", () => {
  async function setEndDate(sql: string) {
    await pool.query(
      `update subscriptions set start_date = (now() at time zone 'Asia/Riyadh')::date - 60,
         end_date = ${sql} where tenant_id = $1`,
      [alNoor.tenantId],
    );
  }

  it("lets Faisal list, count, mark read, and mark all read in Read-only, while a guarded route refuses him", async () => {
    const one = await seed("faisal", "2026-11-02T09:00:00Z");
    const two = await seed("faisal", "2026-11-02T09:01:00Z");
    const three = await seed("faisal", "2026-11-02T09:02:00Z");
    // Read-only: 14 grace days have passed since the end date.
    await setEndDate("(now() at time zone 'Asia/Riyadh')::date - 20");
    try {
      const guarded = await as("sara").get("/subscription");
      expect(guarded.status).toBe(200);
      expect(guarded.body.subscription.state).toBe("read_only");
      const refused = await as("khalid").post("/requests", {});
      expect(failure(refused).code).toBe("SUBSCRIPTION_READ_ONLY");

      const list = await as("faisal").get("/notifications");
      expect(list.status).toBe(200);
      expect(list.body.notifications).toHaveLength(3);
      expect((await as("faisal").get("/notifications/unread-count")).body).toEqual({ count: 3 });
      expect((await as("faisal").post(`/notifications/${one}/read`)).status).toBe(204);
      expect((await as("faisal").post("/notifications/read-all", { upTo: two })).status).toBe(204);
      expect(await unreadIds("faisal")).toEqual([three]);
    } finally {
      await setEndDate("(now() at time zone 'Asia/Riyadh')::date + 365");
    }
  });
});
