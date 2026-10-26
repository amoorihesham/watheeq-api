import { and, count, eq, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { files, subscriptions, tenantMembers, tenantNotices, users } from "@/db/schema/index.js";
import { SUBSCRIPTION_TIME_ZONE } from "./subscriptions.config.js";
import type {
  NewSubscriptionType,
  NoticeKindType,
  SubscriptionChangesType,
  SubscriptionRowType,
} from "./subscriptions.types.js";

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

    today(db: Executor) {
      return db.execute<{ today: string }>(sql`select ${riyadhToday} as today`);
    },

    /** Every tenant that has a subscription, for the hourly notice check. */
    listTenantIds(db: Executor): Promise<{ tenantId: string }[]> {
      return db.select({ tenantId: subscriptions.tenantId }).from(subscriptions);
    },

    /** One row when the notice is new; none when it was already sent (the primary key decides, across instances). */
    insertNotice(db: Executor, tenantId: string, kind: NoticeKindType, key: string) {
      return db
        .insert(tenantNotices)
        .values({ tenantId, kind, key })
        .onConflictDoNothing()
        .returning({ kind: tenantNotices.kind });
    },

    deleteNotice(db: Executor, tenantId: string, kind: NoticeKindType, key: string) {
      return db
        .delete(tenantNotices)
        .where(
          and(
            eq(tenantNotices.tenantId, tenantId),
            eq(tenantNotices.kind, kind),
            eq(tenantNotices.key, key),
          ),
        );
    },

    findByTenantId(db: Executor, tenantId: string): Promise<SubscriptionRowType[]> {
      return db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    },

    update(
      db: Executor,
      tenantId: string,
      values: SubscriptionChangesType,
    ): Promise<SubscriptionRowType[]> {
      return db
        .update(subscriptions)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(subscriptions.tenantId, tenantId))
        .returning();
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

    findStorageLimit(db: Executor, tenantId: string): Promise<{ storageLimitGb: number }[]> {
      return db
        .select({ storageLimitGb: subscriptions.storageLimitGb })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId));
    },

    /** Every stored byte of the tenant, whatever the file's state, computed and never kept as a counter (Q10). */
    sumStoredBytes(db: Executor, tenantId: string): Promise<{ storedBytes: number }[]> {
      return db
        .select({ storedBytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::float8` })
        .from(files)
        .where(eq(files.tenantId, tenantId));
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
