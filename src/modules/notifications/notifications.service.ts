import { sql } from 'drizzle-orm';
import type { Db } from '@/db/pool.js';
import { notifications } from '@/db/schema/index.js';
import { AppError } from '@/http/errors.js';
import { listPage } from '@/http/list.js';
import type { PageType } from '@/http/respond.js';
import type { ListNotificationsQueryType, NotificationsRepositoryType, NotificationType, ReadAllNotificationsRequestType, UnreadCountResponseType } from './notifications.types.js';

const toNotification = (row: { id: string; kind: NotificationType['kind']; requestId: string | null; data: unknown; createdAt: Date; readAt: Date | null }): NotificationType => ({
  id: row.id,
  kind: row.kind,
  request: row.requestId ? { id: row.requestId } : null,
  data: row.data as NotificationType['data'],
  createdAt: row.createdAt,
  readAt: row.readAt,
});

const unknownNotification = (path: string) => new AppError('VALIDATION_FAILED', [{ path, code: 'unknown_notification' }]);

export function createNotificationsService({ db, repo }: { db: Db; repo: NotificationsRepositoryType }) {
  return {
    async list(tenantId: string, userId: string, query: ListNotificationsQueryType): Promise<PageType<NotificationType>> {
      const page = await listPage({
        db,
        list: 'notifications',
        query,
        keys: [
          { expr: sql`${notifications.createdAt}`, type: 'timestamptz' },
          { expr: sql`${notifications.id}`, type: 'uuid' },
        ],
        direction: 'desc',
        where: (filters) => repo.listWhere(tenantId, userId, filters.unread),
        selectPage: repo.page,
        count: repo.count,
      });
      return { ...page, items: page.items.map(toNotification) };
    },

    async unreadCount(tenantId: string, userId: string): Promise<UnreadCountResponseType> {
      const [row] = await repo.unreadCount(db, tenantId, userId);
      return { count: row?.total ?? 0 };
    },

    /** Another user's notification, another tenant's, and a malformed ID all answer 404, so IDs reveal nothing. */
    async markRead(tenantId: string, userId: string, notificationId: string): Promise<void> {
      const updated = await repo.markRead(db, tenantId, userId, notificationId);
      if (updated.length === 0) {
        throw new AppError('NOT_FOUND');
      }
    },

    async markAllRead(tenantId: string, userId: string, { upTo }: ReadAllNotificationsRequestType): Promise<void> {
      if (!(await repo.exists(db, tenantId, userId, upTo))) {
        throw unknownNotification('upTo');
      }
      await repo.markReadUpTo(db, tenantId, userId, upTo);
    },
  };
}
