import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/pool.js";
import { userSessions, users } from "../../db/schema/index.js";
import { withTenantTx } from "../../db/tenant-tx.js";
import { successfulLoginUpdate, wrongPasswordUpdate } from "../shared/account-throttle.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import type { ResolvedSession } from "../shared/session-middleware.js";

export interface UserIdentity {
  id: string;
  email: string;
  tenantId: string;
}

/** The login lookup result: the one pre-context read, done by `auth_find_user_for_login`. */
export interface LoginUser {
  id: string;
  tenantId: string;
  passwordHash: string;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

type LoginUserRow = {
  id: string;
  tenant_id: string;
  password_hash: string;
  is_active: boolean;
  failed_login_count: number;
  locked_until_ms: number | null;
};

// Raw rows from `db.execute` carry timestamps as strings, so the timestamps are selected as epoch milliseconds
// (a float8, which the driver parses to a number) and turned into Dates here.

/** Finds a user by normalized email across all tenants (T7). Goes through the SECURITY DEFINER function, since no tenant is known yet. */
export async function findUserForLogin(db: Db, email: string): Promise<LoginUser | undefined> {
  const result = await db.execute<LoginUserRow>(
    sql`
      select id, tenant_id, password_hash, is_active, failed_login_count,
             (extract(epoch from locked_until) * 1000)::float8 as locked_until_ms
      from auth_find_user_for_login(${email})
    `,
  );
  const row = result.rows[0];
  return (
    row && {
      id: row.id,
      tenantId: row.tenant_id,
      passwordHash: row.password_hash,
      isActive: row.is_active,
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until_ms === null ? null : new Date(row.locked_until_ms),
    }
  );
}

/** One atomic UPDATE in the user's tenant: counts the wrong password and locks the user at the limit. */
export async function recordWrongPassword(
  db: Db,
  user: Pick<LoginUser, "id" | "tenantId">,
  settings: LoginThrottleSettings,
): Promise<void> {
  await withTenantTx(db, user.tenantId, (tx) =>
    tx.update(users).set(wrongPasswordUpdate(users, settings)).where(eq(users.id, user.id)),
  );
}

export interface NewUserSession {
  tenantId: string;
  userId: string;
  tokenHash: Buffer;
  absoluteLifetimeSeconds: number;
  userAgent: string | undefined;
  ip: string;
}

/**
 * In the user's tenant, atomically: resets the failure count, revokes the session behind the presented cookie (if any),
 * and inserts the new one. A presented session of another tenant is invisible here (RLS) and stays untouched,
 * which is harmless because its token is not upgraded and the browser's cookie is replaced.
 */
export async function replaceSession(
  db: Db,
  presentedTokenHash: Buffer | undefined,
  next: NewUserSession,
): Promise<void> {
  await withTenantTx(db, next.tenantId, async (tx) => {
    await tx.update(users).set(successfulLoginUpdate).where(eq(users.id, next.userId));
    if (presentedTokenHash) {
      await tx
        .update(userSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(userSessions.tokenHash, presentedTokenHash), isNull(userSessions.revokedAt)));
    }
    await tx.insert(userSessions).values({
      tenantId: next.tenantId,
      userId: next.userId,
      tokenHash: next.tokenHash,
      expiresAt: sql`now() + make_interval(secs => ${next.absoluteLifetimeSeconds})`,
      userAgent: next.userAgent,
      ip: next.ip,
    });
  });
}

type ResolvedSessionRow = {
  session_id: string;
  tenant_id: string;
  last_seen_ms: number;
  user_id: string;
  email: string;
};

/** Returns the session only if it is valid now (checked in SQL by `auth_resolve_user_session`) and its user is active. */
export async function resolveUserSession(
  db: Db,
  tokenHash: Buffer,
  idleTimeoutSeconds: number,
): Promise<ResolvedSession<UserIdentity> | undefined> {
  const result = await db.execute<ResolvedSessionRow>(
    sql`
      select session_id, tenant_id, user_id, email,
             (extract(epoch from last_seen_at) * 1000)::float8 as last_seen_ms
      from auth_resolve_user_session(${tokenHash}, ${idleTimeoutSeconds})
    `,
  );
  const row = result.rows[0];
  return (
    row && {
      sessionId: row.session_id,
      lastSeenAt: new Date(row.last_seen_ms),
      principal: { id: row.user_id, email: row.email, tenantId: row.tenant_id },
    }
  );
}

/** Conditional, so concurrent requests on one session produce at most one write per minute. */
export async function touchSession(
  db: Db,
  tenantId: string,
  sessionId: string,
  minAgeSeconds: number,
): Promise<void> {
  await withTenantTx(db, tenantId, (tx) =>
    tx
      .update(userSessions)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(userSessions.id, sessionId),
          sql`${userSessions.lastSeenAt} < now() - make_interval(secs => ${minAgeSeconds})`,
        ),
      ),
  );
}

export async function revokeSession(db: Db, tenantId: string, sessionId: string): Promise<void> {
  await withTenantTx(db, tenantId, (tx) =>
    tx
      .update(userSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt))),
  );
}
