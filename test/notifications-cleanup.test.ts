import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/pool.js";
import { buildJobs } from "../src/jobs.js";
import {
  createNotificationsCleanupJob,
  deleteOldReadNotifications,
} from "../src/modules/notifications/index.js";
import { createIsolatedDb, type IsolatedDbType, seedTenant } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";
import { connectToTestStore } from "./helpers/storage.js";

// Phase 7 spec, R7.16: read notifications are deleted 90 days after they were read; unread ones are kept.
// The cleanup deletes every tenant's old rows, so this file runs in a database of its own.

let isolated: IsolatedDbType;
let pool: pg.Pool;
let db: Db;
let tenantId = "";
let khalid = "";

/** One notification, read `readDaysAgo` days ago (null: unread), created `createdDaysAgo` days ago. */
async function seed(readDaysAgo: number | null, createdDaysAgo = 200): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into notifications (tenant_id, user_id, kind, data, created_at, read_at)
     values ($1, $2, 'subscription.ending_soon', '{}', now() - ($3 * interval '1 day'),
       case when $4::float8 is null then null else now() - ($4::float8 * interval '1 day') end)
     returning id`,
    [tenantId, khalid, createdDaysAgo, readDaysAgo],
  );
  return rows[0]?.id ?? "";
}

const remaining = async () =>
  (await pool.query<{ id: string }>("select id from notifications")).rows.map((row) => row.id);

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  db = createDb(pool);
  const tenant = await seedTenant(pool, "notifications-cleanup", [
    { email: "sara@notif-cleanup.test" },
    { email: "khalid@notif-cleanup.test" },
  ]);
  tenantId = tenant.id;
  khalid = tenant.userIds[1] ?? "";
});

afterAll(async () => {
  await isolated.drop();
});

beforeEach(async () => {
  await pool.query("delete from notifications");
});

describe("deleteOldReadNotifications (R7.16)", () => {
  it("deletes notifications read more than 90 days ago and keeps the rest", async () => {
    const old = await seed(91);
    const justOver = await seed(90.01);
    const recent = await seed(89);
    const justRead = await seed(0);
    const unreadOld = await seed(null, 400);
    const unreadNew = await seed(null, 1);

    expect(await deleteOldReadNotifications(db)).toEqual({ deleted: 2 });

    const kept = await remaining();
    expect(kept.sort()).toEqual([recent, justRead, unreadOld, unreadNew].sort());
    expect(kept).not.toContain(old);
    expect(kept).not.toContain(justOver);
  });

  it("works through more than one batch, counting every row", async () => {
    for (let i = 0; i < 7; i++) {
      await seed(100 + i);
    }
    const kept = await seed(10);
    expect(await deleteOldReadNotifications(db, { batchSize: 3 })).toEqual({ deleted: 7 });
    expect(await remaining()).toEqual([kept]);
  });

  it("makes one more pass when a batch comes up exactly full", async () => {
    for (let i = 0; i < 6; i++) {
      await seed(100);
    }
    expect(await deleteOldReadNotifications(db, { batchSize: 3 })).toEqual({ deleted: 6 });
  });

  it("stops between batches when the signal is aborted", async () => {
    for (let i = 0; i < 6; i++) {
      await seed(100);
    }
    const abort = new AbortController();
    abort.abort();
    expect(await deleteOldReadNotifications(db, { batchSize: 3, signal: abort.signal })).toEqual({
      deleted: 0,
    });
    expect(await remaining()).toHaveLength(6);
  });

  it("does nothing when nothing is old enough", async () => {
    await seed(5);
    expect(await deleteOldReadNotifications(db)).toEqual({ deleted: 0 });
  });
});

describe("the notifications.cleanup job", () => {
  it("is a daily job in the list of jobs, and returns the counts", async () => {
    await seed(120);
    const job = createNotificationsCleanupJob();
    expect(job).toMatchObject({ name: "notifications.cleanup", intervalMs: 24 * 60 * 60 * 1000 });
    expect(buildJobs({ fileStore: connectToTestStore() }).map((entry) => entry.name)).toContain(
      "notifications.cleanup",
    );
    expect(
      await job.run({
        db,
        logger: captureLogs().logger,
        signal: new AbortController().signal,
        runId: "job:notifications.cleanup:test",
      }),
    ).toEqual({ deleted: 1 });
  });
});
