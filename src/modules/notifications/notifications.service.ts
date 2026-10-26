import type { Db } from "@/db/pool.js";
import { AppError } from "@/http/errors.js";
import { idSchema, validate } from "@/http/validate.js";
import { listNotificationsQuerySchema, readAllRequestSchema } from "./notifications.schemas.js";
import type {
  ListNotificationsResponseType,
  NotificationRowType,
  NotificationsRepositoryType,
  NotificationType,
  UnreadCountResponseType,
} from "./notifications.types.js";

const toNotification = (row: NotificationRowType): NotificationType => ({
  id: row.id,
  kind: row.kind,
  request: row.requestId ? { id: row.requestId } : null,
  data: row.data,
  createdAt: row.createdAt,
  readAt: row.readAt,
});

const unknownNotification = (path: string) =>
  new AppError("VALIDATION_FAILED", [{ path, code: "unknown_notification" }]);

export function createNotificationsService({
  db,
  repo,
}: {
  db: Db;
  repo: NotificationsRepositoryType;
}) {
  return {
    async list(
      tenantId: string,
      userId: string,
      input: unknown,
    ): Promise<ListNotificationsResponseType> {
      const query = validate(listNotificationsQuerySchema, input);
      if (query.before && !(await repo.exists(db, tenantId, userId, query.before))) {
        throw unknownNotification("before");
      }
      // One extra row tells whether another page follows.
      const rows = await repo.list(db, tenantId, userId, {
        unread: query.unread === "true",
        before: query.before,
        limit: query.limit + 1,
      });
      return {
        notifications: rows.slice(0, query.limit).map(toNotification),
        hasMore: rows.length > query.limit,
      };
    },

    async unreadCount(tenantId: string, userId: string): Promise<UnreadCountResponseType> {
      const [row] = await repo.unreadCount(db, tenantId, userId);
      return { count: row?.total ?? 0 };
    },

    /** Another user's notification, another tenant's, and a malformed ID all answer 404, so IDs reveal nothing. */
    async markRead(tenantId: string, userId: string, notificationId: string): Promise<void> {
      const id = idSchema.safeParse(notificationId);
      if (!id.success) {
        throw new AppError("NOT_FOUND");
      }
      const updated = await repo.markRead(db, tenantId, userId, id.data);
      if (updated.length === 0) {
        throw new AppError("NOT_FOUND");
      }
    },

    async markAllRead(tenantId: string, userId: string, input: unknown): Promise<void> {
      const { upTo } = validate(readAllRequestSchema, input);
      if (!(await repo.exists(db, tenantId, userId, upTo))) {
        throw unknownNotification("upTo");
      }
      await repo.markReadUpTo(db, tenantId, userId, upTo);
    },
  };
}
