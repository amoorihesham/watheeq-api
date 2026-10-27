import { z } from "zod";
import { NOTIFICATION_KINDS } from "./notifications.constants.js";

export const notificationResponseSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  request: z.strictObject({ id: z.string() }).nullable(),
  /** The values the client words the notification from (T11). */
  data: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  readAt: z.date().nullable(),
});

export const unreadCountResponseSchema = z.strictObject({ count: z.number() });
