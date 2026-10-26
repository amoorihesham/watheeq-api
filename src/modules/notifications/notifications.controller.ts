import type { Request, RequestHandler } from "express";
import { AppError } from "@/http/errors.js";
import { sendData, sendNoContent, sendPage } from "@/http/respond.js";
import { principalOf } from "@/modules/auth/index.js";
import {
  notificationResponseSchema,
  unreadCountResponseSchema,
} from "./notifications.responses.js";
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
    list: (async (req, res) => {
      const page = await service.list(tenantOf(req), callerOf(req), req.query);
      sendPage(res, notificationResponseSchema, page);
    }) satisfies RequestHandler,

    unreadCount: (async (req, res) => {
      const body = await service.unreadCount(tenantOf(req), callerOf(req));
      sendData(res, 200, unreadCountResponseSchema, body);
    }) satisfies RequestHandler,

    markRead: (async (req, res) => {
      await service.markRead(tenantOf(req), callerOf(req), String(req.params.id));
      sendNoContent(res);
    }) satisfies RequestHandler,

    markAllRead: (async (req, res) => {
      await service.markAllRead(tenantOf(req), callerOf(req), req.body);
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
