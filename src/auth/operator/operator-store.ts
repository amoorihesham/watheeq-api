import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/pool.js";
import { operatorSessions, operators } from "../../db/schema/index.js";
import type { ResolvedSession } from "../shared/session-middleware.js";

export interface OperatorIdentity {
  id: string;
  email: string;
}

export async function findOperatorByEmail(db: Db, email: string) {
  const [row] = await db.select().from(operators).where(eq(operators.email, email)).limit(1);
  return row;
}

export interface NewSession {
  operatorId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer;
  absoluteLifetimeSeconds: number;
  userAgent: string | undefined;
  ip: string | undefined;
}

/** Revokes the session behind the presented cookie (if any) and inserts the new one, atomically. */
export async function replaceSession(
  db: Db,
  presentedTokenHash: Buffer | undefined,
  next: NewSession,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (presentedTokenHash) {
      await tx
        .update(operatorSessions)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(operatorSessions.tokenHash, presentedTokenHash),
            isNull(operatorSessions.revokedAt),
          ),
        );
    }
    await tx.insert(operatorSessions).values({
      operatorId: next.operatorId,
      tokenHash: next.tokenHash,
      csrfTokenHash: next.csrfTokenHash,
      expiresAt: sql`now() + make_interval(secs => ${next.absoluteLifetimeSeconds})`,
      userAgent: next.userAgent,
      ip: next.ip,
    });
  });
}

/** Returns the session only if it is not revoked, not past its absolute expiry, not idle-expired, and its operator is active. */
export async function resolveOperatorSession(
  db: Db,
  tokenHash: Buffer,
  idleTimeoutSeconds: number,
): Promise<ResolvedSession<OperatorIdentity> | undefined> {
  const [row] = await db
    .select({
      sessionId: operatorSessions.id,
      csrfTokenHash: operatorSessions.csrfTokenHash,
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
        gt(operatorSessions.lastSeenAt, sql`now() - make_interval(secs => ${idleTimeoutSeconds})`),
        eq(operators.isActive, true),
      ),
    )
    .limit(1);
  if (!row) {
    return undefined;
  }
  return {
    sessionId: row.sessionId,
    csrfTokenHash: row.csrfTokenHash,
    lastSeenAt: row.lastSeenAt,
    principal: { id: row.operatorId, email: row.email },
  };
}

/** Conditional, so concurrent requests on one session produce at most one write per minute. */
export async function touchSession(
  db: Db,
  sessionId: string,
  minAgeSeconds: number,
): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(operatorSessions.id, sessionId),
        sql`${operatorSessions.lastSeenAt} < now() - make_interval(secs => ${minAgeSeconds})`,
      ),
    );
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(operatorSessions.id, sessionId), isNull(operatorSessions.revokedAt)));
}

export async function replaceCsrfTokenHash(
  db: Db,
  sessionId: string,
  csrfTokenHash: Buffer,
): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ csrfTokenHash })
    .where(eq(operatorSessions.id, sessionId));
}
