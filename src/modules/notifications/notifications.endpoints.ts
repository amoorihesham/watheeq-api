import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { idSchema } from "@/http/validate.js";
import {
  notificationResponseSchema,
  unreadCountResponseSchema,
} from "./notifications.responses.js";
import { listNotificationsQuerySchema, readAllRequestSchema } from "./notifications.schemas.js";

/** No subscription guard and no permission: the inbox works in Read-only (P7.7). */
export const notificationsApi = defineApi({
  tag: "notifications",
  prefix: "/notifications",
  realm: "tenantInbox",
  endpoints: {
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "The caller's notifications, newest first",
      query: listNotificationsQuerySchema,
      response: { kind: "page", schema: notificationResponseSchema },
    }),
    unreadCount: defineEndpoint({
      method: "get",
      path: "/unread-count",
      summary: "How many notifications the caller has not read",
      response: { kind: "data", status: 200, schema: unreadCountResponseSchema },
    }),
    markAllRead: defineEndpoint({
      method: "post",
      path: "/read-all",
      summary: "Mark the caller's notifications up to one notification as read",
      body: readAllRequestSchema,
      response: { kind: "noContent" },
    }),
    markRead: defineEndpoint({
      method: "post",
      path: "/:id/read",
      summary: "Mark one notification as read; also when it already is",
      params: z.strictObject({ id: idSchema }),
      response: { kind: "noContent" },
    }),
  },
});
