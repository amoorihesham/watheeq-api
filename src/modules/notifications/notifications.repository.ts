import { and, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { notifications, tenantMembers, users } from "@/db/schema/index.js";
import type { NewNotificationType, NotificationRowType } from "./notifications.types.js";

const own = (tenantId: string, userId: string) =>
  and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId));

/** A notification's place in the list order, read in SQL: a JavaScript Date would drop the microseconds. */
const positionOf = (tenantId: string, userId: string, notificationId: string) =>
  sql`(select ${notifications.createdAt}, ${notifications.id} from ${notifications}
    where ${and(own(tenantId, userId), eq(notifications.id, notificationId))})`;

/** Tenant code: every query is filtered by the caller's tenant and user (T2). */
export function createNotificationsRepository() {
  return {
    /** Of `userIds`, those who are active members of the tenant. */
    activeMemberIds(db: Executor, tenantId: string, userIds: string[]): Promise<string[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            inArray(tenantMembers.userId, userIds),
            eq(users.isActive, true),
          ),
        )
        .then((rows) => rows.map((row) => row.userId));
    },

    async insertMany(db: Executor, rows: NewNotificationType[]): Promise<void> {
      await db.insert(notifications).values(rows);
    },

    list(
      db: Executor,
      tenantId: string,
      userId: string,
      query: { unread: boolean; before: string | undefined; limit: number },
    ): Promise<NotificationRowType[]> {
      const filters: (SQL | undefined)[] = [own(tenantId, userId)];
      if (query.unread) {
        filters.push(isNull(notifications.readAt));
      }
      if (query.before) {
        filters.push(
          sql`(${notifications.createdAt}, ${notifications.id}) < ${positionOf(tenantId, userId, query.before)}`,
        );
      }
      return db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          requestId: notifications.requestId,
          data: notifications.data,
          createdAt: notifications.createdAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .where(and(...filters))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.limit);
    },

    /** Whether the notification exists and is the user's own. */
    exists(db: Executor, tenantId: string, userId: string, notificationId: string) {
      return db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(own(tenantId, userId), eq(notifications.id, notificationId)))
        .then((rows) => rows.length > 0);
    },

    unreadCount(db: Executor, tenantId: string, userId: string) {
      return db
        .select({ total: count() })
        .from(notifications)
        .where(and(own(tenantId, userId), isNull(notifications.readAt)));
    },

    /** Marks one read, keeping the first read time; returns no row when it is not the user's. */
    markRead(db: Executor, tenantId: string, userId: string, notificationId: string) {
      return db
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(own(tenantId, userId), eq(notifications.id, notificationId)))
        .returning({ id: notifications.id });
    },

    /** Marks the user's unread notifications at or before `upTo` in list order. */
    markReadUpTo(db: Executor, tenantId: string, userId: string, upTo: string) {
      return db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            own(tenantId, userId),
            isNull(notifications.readAt),
            sql`(${notifications.createdAt}, ${notifications.id}) <= ${positionOf(tenantId, userId, upTo)}`,
          ),
        );
    },
  };
}
