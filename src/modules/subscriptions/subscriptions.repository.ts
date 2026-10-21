import { and, count, eq, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { subscriptions, tenantMembers, users } from "@/db/schema/index.js";
import { SUBSCRIPTION_TIME_ZONE } from "./subscriptions.config.js";
import type { NewSubscriptionType, SubscriptionRowType } from "./subscriptions.types.js";

/** The calendar date in Saudi Arabia of a timestamp expression, as `YYYY-MM-DD`. */
export const riyadhDateOf = (timestamp: SQL) =>
  sql<string>`(${timestamp} at time zone ${sql.raw(`'${SUBSCRIPTION_TIME_ZONE}'`)})::date::text`;

/** The database's current date in Saudi Arabia: every instance agrees on "today" (R1.7). */
export const riyadhToday = riyadhDateOf(sql`now()`);

export function createSubscriptionsRepository() {
  return {
    insert(db: Executor, values: NewSubscriptionType): Promise<SubscriptionRowType[]> {
      return db.insert(subscriptions).values(values).returning();
    },

    today(db: Executor): Promise<{ today: string }[]> {
      return db.execute<{ today: string }>(sql`select ${riyadhToday} as today`).then((r) => r.rows);
    },

    /**
     * Serializes every seat change for one tenant until the transaction ends (Phase 1 spec, 4.1).
     * Keyed by the tenant, so Al-Noor never waits for Al-Rashid.
     */
    lockSeats(db: Executor, tenantId: string) {
      return db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
    },

    findUserLimit(db: Executor, tenantId: string): Promise<{ userLimit: number }[]> {
      return db
        .select({ userLimit: subscriptions.userLimit })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId));
    },

    countActiveMembers(db: Executor, tenantId: string): Promise<{ activeUsers: number }[]> {
      return db
        .select({ activeUsers: count() })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(users.isActive, true)));
    },
  };
}
