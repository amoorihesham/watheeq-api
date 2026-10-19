import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { isUniqueViolation } from "../../../db/errors.js";
import type { Executor } from "../../../db/executor.js";
import { operatorSessions, operators } from "../../../db/schema/index.js";
import { successfulLoginUpdate, wrongPasswordUpdate } from "../shared/account-throttle.js";
import type { LoginThrottleSettings } from "../shared/ip-throttle.js";
import type { ResolvedSession } from "../shared/session.js";

export interface OperatorIdentity {
  id: string;
  email: string;
}

export interface NewOperatorSession {
  operatorId: string;
  tokenHash: Buffer;
  absoluteLifetimeSeconds: number;
  userAgent: string | undefined;
  ip: string | undefined;
}

/** Single queries on the operator tables. Every function runs on the executor it is given and never opens a transaction. */
export function createOperatorRepository() {
  return {
    async findByEmail(db: Executor, email: string) {
      const [row] = await db.select().from(operators).where(eq(operators.email, email)).limit(1);
      return row;
    },

    /** Inserts an operator. Returns undefined if the email is already taken. */
    async insert(
      db: Executor,
      values: { email: string; passwordHash: string },
    ): Promise<{ id: string; email: string } | undefined> {
      try {
        const [row] = await db
          .insert(operators)
          .values(values)
          .returning({ id: operators.id, email: operators.email });
        if (!row) {
          throw new Error("insert returned no row");
        }
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) {
          return undefined;
        }
        throw err;
      }
    },

    /** One atomic UPDATE: counts the wrong password and locks the operator at the limit. */
    async recordWrongPassword(
      db: Executor,
      operatorId: string,
      settings: LoginThrottleSettings,
    ): Promise<void> {
      await db
        .update(operators)
        .set(wrongPasswordUpdate(operators, settings))
        .where(eq(operators.id, operatorId));
    },

    /** A successful login: the failure count starts over and any expired lock is cleared. */
    async resetLoginFailures(db: Executor, operatorId: string): Promise<void> {
      await db.update(operators).set(successfulLoginUpdate).where(eq(operators.id, operatorId));
    },

    async revokeSessionByTokenHash(db: Executor, tokenHash: Buffer): Promise<void> {
      await db
        .update(operatorSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(operatorSessions.tokenHash, tokenHash), isNull(operatorSessions.revokedAt)));
    },

    async insertSession(db: Executor, next: NewOperatorSession): Promise<void> {
      await db.insert(operatorSessions).values({
        operatorId: next.operatorId,
        tokenHash: next.tokenHash,
        expiresAt: sql`now() + make_interval(secs => ${next.absoluteLifetimeSeconds})`,
        userAgent: next.userAgent,
        ip: next.ip,
      });
    },

    /** Returns the session only if it is not revoked, not past its absolute expiry, not idle-expired, and its operator is active. */
    async resolveSession(
      db: Executor,
      tokenHash: Buffer,
      idleTimeoutSeconds: number,
    ): Promise<ResolvedSession<OperatorIdentity> | undefined> {
      const [row] = await db
        .select({
          sessionId: operatorSessions.id,
          lastSeenAt: operatorSessions.lastSeenAt,
          operatorId: operators.id,
          email: operators.email,
        })
        .from(operatorSessions)
        .innerJoin(operators, eq(operators.id, operatorSessions.operatorId))
        .where(
          and(
            eq(operatorSessions.tokenHash, tokenHash),
            isNull(operatorSessions.revokedAt),
            gt(operatorSessions.expiresAt, sql`now()`),
            gt(
              operatorSessions.lastSeenAt,
              sql`now() - make_interval(secs => ${idleTimeoutSeconds})`,
            ),
            eq(operators.isActive, true),
          ),
        )
        .limit(1);
      if (!row) {
        return undefined;
      }
      return {
        sessionId: row.sessionId,
        lastSeenAt: row.lastSeenAt,
        principal: { id: row.operatorId, email: row.email },
      };
    },

    /** Conditional, so concurrent requests on one session produce at most one write per minute. */
    async touchSession(db: Executor, sessionId: string, minAgeSeconds: number): Promise<void> {
      await db
        .update(operatorSessions)
        .set({ lastSeenAt: sql`now()` })
        .where(
          and(
            eq(operatorSessions.id, sessionId),
            sql`${operatorSessions.lastSeenAt} < now() - make_interval(secs => ${minAgeSeconds})`,
          ),
        );
    },

    async revokeSession(db: Executor, sessionId: string): Promise<void> {
      await db
        .update(operatorSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(operatorSessions.id, sessionId), isNull(operatorSessions.revokedAt)));
    },
  };
}

export type OperatorRepository = ReturnType<typeof createOperatorRepository>;
