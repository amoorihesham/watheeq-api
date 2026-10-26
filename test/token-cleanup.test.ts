import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/pool.js";
import { createTokenCleanupJob, deleteExpiredTokens } from "../src/modules/auth/index.js";
import { createIsolatedDb, type IsolatedDbType, seedUser } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

// Phase 7 spec, R7.17: the daily cleanup of expired refresh tokens and password tokens.

// The cleanup deletes every user's expired rows, so this file runs in a database of its own.
let isolated: IsolatedDbType;
let pool: pg.Pool;
let db: Db;
let userId = "";

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  db = createDb(pool);
  userId = await seedUser(pool, { email: "khalid@token-cleanup.test" });
});

afterAll(async () => {
  await isolated.drop();
});

beforeEach(async () => {
  await pool.query("delete from refresh_tokens");
  await pool.query("delete from password_tokens");
});

type Expiry = "expired" | "valid";

async function seedRefreshToken(expiry: Expiry, revoked: boolean): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into refresh_tokens (user_id, token_hash, expires_at, revoked_at)
     values ($1, $2, now() + ($3::int * interval '1 hour'), case when $4 then now() end) returning id`,
    [userId, randomUUID(), expiry === "expired" ? -1 : 1, revoked],
  );
  return rows[0]?.id ?? "";
}

async function seedPasswordToken(expiry: Expiry, used: boolean): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into password_tokens (user_id, purpose, token_hash, expires_at, used_at)
     values ($1, 'reset', $2, now() + ($3::int * interval '1 hour'), case when $4 then now() end) returning id`,
    [userId, randomUUID(), expiry === "expired" ? -1 : 1, used],
  );
  return rows[0]?.id ?? "";
}

async function remaining(table: "refresh_tokens" | "password_tokens"): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(`select id from ${table}`);
  return rows.map((row) => row.id);
}

describe("deleteExpiredTokens", () => {
  it("deletes expired refresh tokens, revoked or not, and keeps the rest", async () => {
    const expiredLive = await seedRefreshToken("expired", false);
    const expiredRevoked = await seedRefreshToken("expired", true);
    const validRevoked = await seedRefreshToken("valid", true);
    const validLive = await seedRefreshToken("valid", false);

    const counts = await deleteExpiredTokens(db);

    expect(counts).toEqual({ refreshTokens: 2, passwordTokens: 0 });
    const kept = await remaining("refresh_tokens");
    expect(kept.sort()).toEqual([validRevoked, validLive].sort());
    expect(kept).not.toContain(expiredLive);
    expect(kept).not.toContain(expiredRevoked);
  });

  it("deletes expired password tokens, used or not, and keeps the rest", async () => {
    const expiredUnused = await seedPasswordToken("expired", false);
    const expiredUsed = await seedPasswordToken("expired", true);
    const validUsed = await seedPasswordToken("valid", true);
    const validUnused = await seedPasswordToken("valid", false);

    const counts = await deleteExpiredTokens(db);

    expect(counts).toEqual({ refreshTokens: 0, passwordTokens: 2 });
    const kept = await remaining("password_tokens");
    expect(kept.sort()).toEqual([validUsed, validUnused].sort());
    expect(kept).not.toContain(expiredUnused);
    expect(kept).not.toContain(expiredUsed);
  });

  it("works through more than one batch, counting every row", async () => {
    for (let i = 0; i < 7; i++) {
      await seedRefreshToken("expired", i % 2 === 0);
    }
    for (let i = 0; i < 5; i++) {
      await seedPasswordToken("expired", i % 2 === 0);
    }
    const keptRefresh = await seedRefreshToken("valid", false);
    const keptPassword = await seedPasswordToken("valid", false);

    const counts = await deleteExpiredTokens(db, { batchSize: 3 });

    expect(counts).toEqual({ refreshTokens: 7, passwordTokens: 5 });
    expect(await remaining("refresh_tokens")).toEqual([keptRefresh]);
    expect(await remaining("password_tokens")).toEqual([keptPassword]);
  });

  it("makes one more pass when a batch comes up exactly full", async () => {
    for (let i = 0; i < 6; i++) {
      await seedRefreshToken("expired", false);
    }
    const counts = await deleteExpiredTokens(db, { batchSize: 3 });
    expect(counts.refreshTokens).toBe(6);
    expect(await remaining("refresh_tokens")).toEqual([]);
  });

  it("stops between batches when the signal is aborted", async () => {
    for (let i = 0; i < 6; i++) {
      await seedRefreshToken("expired", false);
    }
    const abort = new AbortController();
    abort.abort();
    const counts = await deleteExpiredTokens(db, { batchSize: 3, signal: abort.signal });
    expect(counts).toEqual({ refreshTokens: 0, passwordTokens: 0 });
    expect(await remaining("refresh_tokens")).toHaveLength(6);
  });

  it("does nothing, and reports zeros, when nothing has expired", async () => {
    await seedRefreshToken("valid", false);
    await seedPasswordToken("valid", false);
    expect(await deleteExpiredTokens(db)).toEqual({ refreshTokens: 0, passwordTokens: 0 });
  });
});

describe("the auth.token_cleanup job", () => {
  it("runs daily and returns the counts", async () => {
    await seedRefreshToken("expired", false);
    await seedPasswordToken("expired", false);
    const job = createTokenCleanupJob();
    expect(job.name).toBe("auth.token_cleanup");
    expect(job.intervalMs).toBe(24 * 60 * 60 * 1000);
    const counts = await job.run({
      db,
      logger: captureLogs().logger,
      signal: new AbortController().signal,
      runId: "job:auth.token_cleanup:test",
    });
    expect(counts).toEqual({ refreshTokens: 1, passwordTokens: 1 });
  });
});
