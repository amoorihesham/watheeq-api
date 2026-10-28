import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { notificationKinds } from '@/db/schema/index.js';
import type { createNotificationsController } from './notifications.controller.js';
import type { createNotificationsRepository } from './notifications.repository.js';
import type { notificationResponseSchema, unreadCountResponseSchema } from './notifications.responses.js';
import type { listNotificationsQuerySchema, readAllRequestSchema } from './notifications.schemas.js';
import type { createNotificationsService } from './notifications.service.js';

export type NotificationKindType = (typeof notificationKinds.enumValues)[number];

export interface NotifyInputType {
  tenantId: string;
  recipients: readonly string[];
  /** The user who acted; never notified of their own action (R7.11). */
  actorId?: string;
  kind: NotificationKindType;
  requestId?: string;
  /** `{number, title}` for request kinds, plus the kind's own values (Phase 7 spec, 4.3). */
  data: Record<string, unknown>;
}

export interface NewNotificationType {
  tenantId: string;
  userId: string;
  kind: NotificationKindType;
  requestId: string | null;
  data: Record<string, unknown>;
}

export type NotificationType = z.output<typeof notificationResponseSchema>;
export type UnreadCountResponseType = z.output<typeof unreadCountResponseSchema>;
export type ListNotificationsQueryType = z.output<typeof listNotificationsQuerySchema>;
export type ReadAllNotificationsRequestType = z.output<typeof readAllRequestSchema>;

export interface NotificationsRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type NotificationsRepositoryType = ReturnType<typeof createNotificationsRepository>;
export type NotificationsServiceType = ReturnType<typeof createNotificationsService>;
export type NotificationsControllerType = ReturnType<typeof createNotificationsController>;
