import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { AppError } from "@/http/errors.js";
import { principalOf } from "@/modules/auth/index.js";
import type { notificationsApi } from "./notifications.endpoints.js";
import type { NotificationsServiceType } from "./notifications.types.js";

/** These routes skip `subscriptionGuard` (P7.7), so the tenant comes from the token. */
const tenantOf = (req: Request) => {
  const tenantId = principalOf(req).tenant?.id;
  if (!tenantId) {
    throw new AppError("FORBIDDEN");
  }
  return tenantId;
};
const callerOf = (req: Request) => principalOf(req).id;

export function createNotificationsController({ service }: { service: NotificationsServiceType }) {
  return {
    list: (async ({ query }, req) =>
      service.list(tenantOf(req), callerOf(req), query)) satisfies HandlerOf<
      typeof notificationsApi.endpoints.list
    >,

    unreadCount: (async (_input, req) =>
      service.unreadCount(tenantOf(req), callerOf(req))) satisfies HandlerOf<
      typeof notificationsApi.endpoints.unreadCount
    >,

    markRead: (async ({ params }, req) => {
      await service.markRead(tenantOf(req), callerOf(req), params.id);
    }) satisfies HandlerOf<typeof notificationsApi.endpoints.markRead>,

    markAllRead: (async ({ body }, req) => {
      await service.markAllRead(tenantOf(req), callerOf(req), body);
    }) satisfies HandlerOf<typeof notificationsApi.endpoints.markAllRead>,
  };
}
