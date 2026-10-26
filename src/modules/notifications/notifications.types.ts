import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { notificationKinds } from "@/db/schema/index.js";
import type { createNotificationsController } from "./notifications.controller.js";
import type { createNotificationsRepository } from "./notifications.repository.js";
import type { createNotificationsService } from "./notifications.service.js";

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

export interface NotificationRowType {
  id: string;
  kind: NotificationKindType;
  requestId: string | null;
  data: unknown;
  createdAt: Date;
  readAt: Date | null;
}

export interface NotificationType {
  id: string;
  kind: NotificationKindType;
  request: { id: string } | null;
  data: unknown;
  createdAt: Date;
  readAt: Date | null;
}

export interface ListNotificationsResponseType {
  notifications: NotificationType[];
  hasMore: boolean;
}

export interface UnreadCountResponseType {
  count: number;
}

export interface NotificationsRouterDepsType {
  db: Db;
  config: Config;
}

export type NotificationsRepositoryType = ReturnType<typeof createNotificationsRepository>;
export type NotificationsServiceType = ReturnType<typeof createNotificationsService>;
export type NotificationsControllerType = ReturnType<typeof createNotificationsController>;
