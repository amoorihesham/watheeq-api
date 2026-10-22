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

export interface SeedRole {
  name: string;
  isSystem?: boolean;
  /** Permission keys with their scope; defaults to none. */
  permissions?: { key: string; scope: string }[];
}

/** Inserts one role and its grants. Returns the role id. */
export async function seedRole(
  db: pg.Pool | pg.PoolClient,
  tenantId: string,
  role: SeedRole,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into roles (tenant_id, name, is_system) values ($1, $2, $3) returning id",
    [tenantId, role.name, role.isSystem ?? false],
  );
  const roleId = rows[0]?.id ?? "";
  for (const { key, scope } of role.permissions ?? []) {
    await db.query(
      "insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, $3, $4)",
      [tenantId, roleId, key, scope],
    );
  }
  return roleId;
}

/** What Phase 2's `member` could do: read the structure and the directory, nothing else. */
export const MEMBER_ROLE: SeedRole = {
  name: "Member",
  permissions: [
    { key: "org.view", scope: "organization" },
    { key: "user.view", scope: "organization" },
  ],
};

export interface SeededTenant {
  id: string;
  userIds: string[];
  /** The Tenant Admin system role, held by the owner. */
  adminRoleId: string;
  /** `MEMBER_ROLE`, held by everyone else. */
  memberRoleId: string;
}

/**
 * Inserts a tenant whose owner is the first user, with every user as a member, in one transaction.
 * The owner holds the Tenant Admin role; the others hold `MEMBER_ROLE`.
 */
export async function seedTenant(
  pool: pg.Pool,
  slug: string,
  members: SeedUser[],
): Promise<SeededTenant> {
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
    const adminRoleId = await seedRole(client, id, { name: "Tenant Admin", isSystem: true });
    const memberRoleId = await seedRole(client, id, MEMBER_ROLE);
    for (const [index, userId] of userIds.entries()) {
      await client.query(
        "insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [id, userId, index === 0 ? adminRoleId : memberRoleId],
      );
    }
    await client.query("commit");
    return { id, userIds, adminRoleId, memberRoleId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `seedTenant`, plus a plan and an Active subscription, so the tenant's users pass the subscription guard.
 * The plan is named after the slug and allows `userLimit` users (default 50).
 */
export async function seedSubscribedTenant(
  pool: pg.Pool,
  slug: string,
  members: SeedUser[],
  userLimit = 50,
): Promise<SeededTenant> {
  const tenant = await seedTenant(pool, slug, members);
  await pool.query(
    `with plan as (
       insert into plans (name, user_limit, grace_days, price_halalas, payment_period)
       values ($2, $3, 14, 100000, 'monthly') returning id, name, user_limit, grace_days
     )
     insert into subscriptions (tenant_id, plan_id, plan_name, user_limit, grace_days, price_halalas,
       payment_period, plan_discount_percent, start_date, end_date)
     select $1, id, name, user_limit, grace_days, 100000, 'monthly', 0,
       (now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date + 365
     from plan`,
    [tenant.id, `Plan ${slug}`, userLimit],
  );
  return tenant;
}
