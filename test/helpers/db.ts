import type pg from "pg";
import { inject } from "vitest";
import { createPool } from "../../src/db/pool.js";
import { createLogger, type Logger } from "../../src/logging/logger.js";

/** A pool connected to the test database, as the application connects. */
export function connectToTestDb(logger: Logger = createLogger("silent")): pg.Pool {
  return createPool(inject("databaseUrl"), logger);
}

/** Drizzle wraps driver errors; the PostgreSQL message is on `cause`. */
export async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = err instanceof Error ? err.cause : undefined;
    return `${String(err)} | ${String(cause)}`;
  }
  throw new Error("expected the promise to reject");
}

export interface SeedUser {
  email: string;
  /** Defaults to the part of the email before the @. */
  userName?: string;
  /** Defaults to a placeholder that no password verifies against. */
  passwordHash?: string;
  isActive?: boolean;
  role?: "user" | "operator";
  /** Defaults to true; an unverified user cannot log in (Phase 1 spec, P1.17). */
  verified?: boolean;
}

/** Inserts one user. Returns the user id. */
export async function seedUser(db: pg.Pool | pg.PoolClient, user: SeedUser): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into users (email, user_name, password_hash, is_active, role, email_verified_at) values ($1, $2, $3, $4, $5, case when $6 then now() end) returning id",
    [
      user.email,
      user.userName ?? user.email.split("@")[0],
      user.passwordHash ?? "x",
      user.isActive ?? true,
      user.role ?? "user",
      user.verified ?? true,
    ],
  );
  return rows[0]?.id ?? "";
}

/**
 * Inserts a tenant whose owner is the first user, with every user as a member, in one transaction.
 * The owner's membership role is `admin`; the others are `member`.
 */
export async function seedTenant(
  pool: pg.Pool,
  slug: string,
  members: SeedUser[],
): Promise<{ id: string; userIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const userIds: string[] = [];
    for (const member of members) {
      userIds.push(await seedUser(client, member));
    }
    const { rows } = await client.query<{ id: string }>(
      "insert into tenants (name, slug, owner_id) values ($1, $1, $2) returning id",
      [slug, userIds[0] ?? null],
    );
    const id = rows[0]?.id ?? "";
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        "insert into tenant_members (tenant_id, user_id, role) values ($1, $2, $3)",
        [id, userId, index === 0 ? "admin" : "member"],
      );
    }
    await client.query("commit");
    return { id, userIds };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
