import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../../../db/executor.js";
import { dateFromEpochMs } from "../../../db/rows.js";
import { userSessions, users } from "../../../db/schema/index.js";
import { successfulLoginUpdate, wrongPasswordUpdate } from "../shared/account-throttle.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import type { ResolvedSession } from "../shared/session.js";

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

type ResolvedSessionRow = {
  session_id: string;
  tenant_id: string;
  last_seen_ms: number;
  user_id: string;
  email: string;
};

export interface NewUserSession {
  tenantId: string;
  userId: string;
  tokenHash: Buffer;
  absoluteLifetimeSeconds: number;
  userAgent: string | undefined;
  ip: string;
}

/**
 * Single queries on the tenant user tables. Every function runs on the executor it is given and never opens a transaction.
 * Queries on tenant tables need an executor that carries the tenant context (a `withTenantTx` transaction), which the service provides.
 * The two pre-tenant lookups (`findUserForLogin`, `resolveSession`) go through SECURITY DEFINER functions instead (T13), since no tenant is known yet.
 */
export function createTenantRepository() {
  return {
    /** Finds a user by normalized email across all tenants (T7). Goes through the SECURITY DEFINER function, since no tenant is known yet. */
    async findUserForLogin(db: Executor, email: string): Promise<LoginUser | undefined> {
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
          lockedUntil: dateFromEpochMs(row.locked_until_ms),
        }
      );
    },

    /** One atomic UPDATE: counts the wrong password and locks the user at the limit. */
    async recordWrongPassword(
      db: Executor,
      userId: string,
      settings: LoginThrottleSettings,
    ): Promise<void> {
      await db.update(users).set(wrongPasswordUpdate(users, settings)).where(eq(users.id, userId));
    },

    /** A successful login: the failure count starts over and any expired lock is cleared. */
    async resetLoginFailures(db: Executor, userId: string): Promise<void> {
      await db.update(users).set(successfulLoginUpdate).where(eq(users.id, userId));
    },

    /**
     * A presented session of another tenant is invisible here (RLS) and stays untouched,
     * which is harmless because its token is not upgraded and the browser's cookie is replaced.
     */
    async revokeSessionByTokenHash(db: Executor, tokenHash: Buffer): Promise<void> {
      await db
        .update(userSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
    },

    async insertSession(db: Executor, next: NewUserSession): Promise<void> {
      await db.insert(userSessions).values({
        tenantId: next.tenantId,
        userId: next.userId,
        tokenHash: next.tokenHash,
        expiresAt: sql`now() + make_interval(secs => ${next.absoluteLifetimeSeconds})`,
        userAgent: next.userAgent,
        ip: next.ip,
      });
    },

    /** Returns the session only if it is valid now (checked in SQL by `auth_resolve_user_session`) and its user is active. */
    async resolveSession(
      db: Executor,
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
          lastSeenAt: dateFromEpochMs(row.last_seen_ms),
          principal: { id: row.user_id, email: row.email, tenantId: row.tenant_id },
        }
      );
    },

    /** Conditional, so concurrent requests on one session produce at most one write per minute. */
    async touchSession(db: Executor, sessionId: string, minAgeSeconds: number): Promise<void> {
      await db
        .update(userSessions)
        .set({ lastSeenAt: sql`now()` })
        .where(
          and(
            eq(userSessions.id, sessionId),
            sql`${userSessions.lastSeenAt} < now() - make_interval(secs => ${minAgeSeconds})`,
          ),
        );
    },

    async revokeSession(db: Executor, sessionId: string): Promise<void> {
      await db
        .update(userSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
    },
  };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
