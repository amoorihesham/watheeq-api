import pg from "pg";
import { inject } from "vitest";
import { createPool } from "../../src/db/pool.js";
import { createLogger, type Logger } from "../../src/logging/logger.js";

/** A pool connected as the runtime role (`watheeq_app`), as the application connects. */
export function connectAsApp(logger: Logger = createLogger("silent")): pg.Pool {
  return createPool(inject("databaseUrl"), logger);
}

/** A pool connected as the container superuser, for fixtures only: it bypasses RLS, which FORCE applies to the owner role. */
export function connectAsAdmin(max = 2): pg.Pool {
  return new pg.Pool({ connectionString: inject("adminDatabaseUrl"), max });
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
  /** Defaults to a placeholder that no password verifies against. */
  passwordHash?: string;
  isActive?: boolean;
}

/**
 * Inserts a tenant and its users in one transaction through the superuser.
 * Fixtures go in this way so tests can seed any tenant without depending on the operator API under test.
 * Returns the tenant id and the user ids in the order given.
 */
export async function seedTenant(
  admin: pg.Pool,
  name: string,
  users: SeedUser[] = [],
): Promise<{ id: string; userIds: string[] }> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    const t = await client.query<{ id: string }>(
      "insert into tenants (name) values ($1) returning id",
      [name],
    );
    const id = t.rows[0]?.id ?? "";
    await client.query("select set_config('app.tenant_id', $1, true)", [id]);
    const userIds: string[] = [];
    for (const user of users) {
      userIds.push(await insertUser(client, id, user));
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

/** Inserts one user into an existing tenant through the superuser. Returns the user id. */
export function seedUser(admin: pg.Pool, tenantId: string, user: SeedUser): Promise<string> {
  return insertUser(admin, tenantId, user);
}

/** Inserts one operator through the superuser. Returns the operator id. */
export async function seedOperator(admin: pg.Pool, operator: SeedUser): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "insert into operators (email, password_hash, is_active) values ($1, $2, $3) returning id",
    [operator.email, operator.passwordHash ?? "x", operator.isActive ?? true],
  );
  return rows[0]?.id ?? "";
}

async function insertUser(
  db: pg.Pool | pg.PoolClient,
  tenantId: string,
  user: SeedUser,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into users (tenant_id, email, password_hash, is_active) values ($1, $2, $3, $4) returning id",
    [tenantId, user.email, user.passwordHash ?? "x", user.isActive ?? true],
  );
  return rows[0]?.id ?? "";
}
