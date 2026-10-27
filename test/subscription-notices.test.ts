import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/pool.js";
import { buildJobs } from "../src/jobs.js";
import {
  checkSubscriptionNotices,
  createSubscriptionNoticesJob,
} from "../src/modules/subscriptions/index.js";
import { testConfig } from "./helpers/config.js";
import {
  createIsolatedDb,
  type IsolatedDbType,
  seedRole,
  seedSubscribedTenant,
} from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";
import { connectToTestStore } from "./helpers/storage.js";

// Phase 7 spec, R7.13 and section 5: the hourly subscription warnings.
// The job checks every tenant, so this file runs in a database of its own.

let isolated: IsolatedDbType;
let pool: pg.Pool;
let db: Db;
let tenantId = "";
let sara = "";
let majed = "";
let reem = "";
let khalid = "";

const logger = captureLogs().logger;
const run = (today: string) => checkSubscriptionNotices(db, { logger, today });

const none = { endingSoon: 0, graceStarted: 0, readOnlyStarted: 0, failed: 0 };

const setSubscription = (endDate: string, graceDays = 14) =>
  pool.query(
    "update subscriptions set start_date = '2020-01-01', end_date = $2, grace_days = $3 where tenant_id = $1",
    [tenantId, endDate, graceDays],
  );

interface InboxRowType {
  user_id: string;
  kind: string;
  request_id: string | null;
  data: Record<string, unknown>;
}

const inbox = async (): Promise<InboxRowType[]> =>
  (
    await pool.query<InboxRowType>(
      "select user_id, kind, request_id, data from notifications order by created_at, id",
    )
  ).rows;

const told = async (kind: string) =>
  (await inbox())
    .filter((row) => row.kind === kind)
    .map((row) => row.user_id)
    .sort();

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  db = createDb(pool);
  const tenant = await seedSubscribedTenant(pool, "notices-al-noor", [
    { email: "sara@notices.test" },
    { email: "majed@notices.test" },
    { email: "reem@notices.test" },
    { email: "khalid@notices.test" },
  ]);
  tenantId = tenant.id;
  [sara, majed, reem, khalid] = tenant.userIds as [string, string, string, string];
  const viewer = await seedRole(pool, tenantId, {
    name: "Finance Lead",
    permissions: [{ key: "subscription.view", scope: "organization" }],
  });
  for (const userId of [majed, reem]) {
    await pool.query("update tenant_members set role_id = $2 where user_id = $1", [userId, viewer]);
  }
});

afterAll(async () => {
  await isolated.drop();
});

beforeEach(async () => {
  await pool.query("delete from notifications");
  await pool.query("delete from tenant_notices");
  await pool.query("update users set is_active = true");
  await setSubscription("2026-12-31");
});

describe("the three warnings (R7.13)", () => {
  it("tells the holders of subscription.view at 14 days, when Grace starts, and when Read-only starts", async () => {
    expect(await run("2026-12-16")).toEqual(none);
    expect(await inbox()).toEqual([]);

    expect(await run("2026-12-17")).toEqual({ ...none, endingSoon: 1 });
    expect(await told("subscription.ending_soon")).toEqual([sara, majed, reem].sort());
    expect((await inbox())[0]).toMatchObject({
      request_id: null,
      data: { endDate: "2026-12-31" },
    });

    expect(await run("2027-01-01")).toEqual({ ...none, graceStarted: 1 });
    const grace = (await inbox()).find((row) => row.kind === "subscription.grace_started");
    expect(grace?.data).toEqual({ endDate: "2026-12-31", readOnlyFrom: "2027-01-15" });

    expect(await run("2027-01-14")).toEqual(none);
    expect(await run("2027-01-15")).toEqual({ ...none, readOnlyStarted: 1 });
    expect(await told("subscription.read_only_started")).toEqual([sara, majed, reem].sort());
  });

  it("never tells people without the permission", async () => {
    await run("2026-12-20");
    expect((await inbox()).some((row) => row.user_id === khalid)).toBe(false);
  });

  it("does not tell an inactive holder", async () => {
    await pool.query("update users set is_active = false where id = $1", [reem]);
    await run("2026-12-20");
    expect(await told("subscription.ending_soon")).toEqual([sara, majed].sort());
  });

  it("sends each warning once per end date, however often the check runs or how many instances run it", async () => {
    await run("2026-12-17");
    expect(await run("2026-12-17")).toEqual(none);
    expect(await run("2026-12-30")).toEqual(none);

    await pool.query("delete from tenant_notices");
    await pool.query("delete from notifications");
    const [a, b] = await Promise.all([run("2026-12-17"), run("2026-12-17")]);
    expect(a.endingSoon + b.endingSoon).toBe(1);
    expect(await inbox()).toHaveLength(3);
  });

  it("starts the warnings again after an extension, before the new end date", async () => {
    await run("2026-12-17");
    await setSubscription("2027-12-31");
    expect(await run("2026-12-20")).toEqual(none);
    expect(await run("2027-12-16")).toEqual(none);
    expect(await run("2027-12-17")).toEqual({ ...none, endingSoon: 1 });
    expect(await told("subscription.ending_soon")).toHaveLength(6);
    expect((await inbox()).at(-1)?.data).toEqual({ endDate: "2027-12-31" });
  });
});

describe("only the current notice (section 5)", () => {
  it("sends Read-only alone to a tenant first seen after its grace ended", async () => {
    expect(await run("2027-02-01")).toEqual({ ...none, readOnlyStarted: 1 });
    expect((await inbox()).map((row) => row.kind)).toEqual([
      "subscription.read_only_started",
      "subscription.read_only_started",
      "subscription.read_only_started",
    ]);
  });

  it("sends Grace alone to a tenant first seen in Grace", async () => {
    expect(await run("2027-01-05")).toEqual({ ...none, graceStarted: 1 });
  });

  it("goes from ends soon straight to Read-only with 0 grace days", async () => {
    await setSubscription("2026-12-31", 0);
    expect(await run("2026-12-17")).toEqual({ ...none, endingSoon: 1 });
    expect(await run("2027-01-01")).toEqual({ ...none, readOnlyStarted: 1 });
    expect((await inbox()).some((row) => row.kind === "subscription.grace_started")).toBe(false);
  });

  it("sends only the current notice after the operator ends a subscription early to a past date", async () => {
    await setSubscription("2026-12-19");
    expect(await run("2026-12-20")).toEqual({ ...none, graceStarted: 1 });

    await pool.query("delete from tenant_notices");
    await pool.query("delete from notifications");
    await setSubscription("2026-11-01");
    expect(await run("2026-12-20")).toEqual({ ...none, readOnlyStarted: 1 });
  });

  it("sends nothing to a tenant far from its end date", async () => {
    await setSubscription("2027-12-31");
    expect(await run("2026-12-01")).toEqual(none);
  });
});

describe("the subscriptions.notices job", () => {
  it("is an hourly job in the list of jobs, and reads the database date when none is given", async () => {
    const job = createSubscriptionNoticesJob(testConfig().jobs.subscriptionNotices);
    expect(job).toMatchObject({ name: "subscriptions.notices", intervalMs: 60 * 60 * 1000 });
    expect(
      buildJobs({ fileStore: connectToTestStore(), jobs: testConfig().jobs }).map(
        (entry) => entry.name,
      ),
    ).toContain("subscriptions.notices");
    // Ends 2026-12-31: far from the real date this suite runs on or past it, either way it must not throw.
    const counts = await job.run({
      db,
      logger,
      signal: new AbortController().signal,
      runId: "job:subscriptions.notices:test",
    });
    expect(counts.failed).toBe(0);
  });

  it("stops between tenants when the signal is aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(
      await checkSubscriptionNotices(db, { logger, today: "2027-02-01", signal: abort.signal }),
    ).toEqual(none);
  });
});
