import { and, count, eq, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '@/db/pool.js';
import { notifications, tenantMembers, users } from '@/db/schema/index.js';
import type { PageRequestType } from '@/http/list.js';
import type { NewNotificationType } from './notifications.types.js';

const own = (tenantId: string, userId: string) => and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId));

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
        .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, userIds), eq(users.isActive, true)))
        .then((rows) => rows.map((row) => row.userId));
    },

    async insertMany(db: Executor, rows: NewNotificationType[]): Promise<void> {
      await db.insert(notifications).values(rows);
    },

    page(db: Executor, page: PageRequestType) {
      return db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          requestId: notifications.requestId,
          data: notifications.data,
          createdAt: notifications.createdAt,
          readAt: notifications.readAt,
          sortValues: page.sortValues,
        })
        .from(notifications)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    /** The caller's own notifications, narrowed by the `unread` filter (`true` unread, `false` read only). */
    listWhere(tenantId: string, userId: string, unread: string): SQL | undefined {
      return and(own(tenantId, userId), unread === 'true' ? isNull(notifications.readAt) : undefined, unread === 'false' ? isNotNull(notifications.readAt) : undefined);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(notifications).where(where);
      return row?.total ?? 0;
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
        .where(and(own(tenantId, userId), isNull(notifications.readAt), sql`(${notifications.createdAt}, ${notifications.id}) <= ${positionOf(tenantId, userId, upTo)}`));
    },

    /**
     * Deletes up to `limit` notifications read more than `days` days ago; unread ones are never touched. `SKIP LOCKED`
     * lets several instances split the work.
     */
    deleteReadBefore(db: Executor, days: number, limit: number): Promise<{ id: string }[]> {
      const due = db
        .select({ id: notifications.id })
        .from(notifications)
        .where(lt(notifications.readAt, sql`now() - ${days} * interval '1 day'`))
        .limit(limit)
        .for('update', { skipLocked: true });
      return db.delete(notifications).where(inArray(notifications.id, due)).returning({ id: notifications.id });
    },
  };
}
