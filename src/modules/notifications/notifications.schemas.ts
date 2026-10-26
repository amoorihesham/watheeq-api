import { z } from "zod";
import { idSchema } from "@/http/validate.js";
import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
} from "./notifications.config.js";

// Query strings stay lenient: links and proxies add parameters the API does not control (T25).
export const listNotificationsQuerySchema = z.object({
  // `false` means no filter, so a client can send its toggle's value as it is.
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  before: idSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_NOTIFICATION_PAGE_SIZE)
    .default(DEFAULT_NOTIFICATION_PAGE_SIZE),
});

export const readAllRequestSchema = z.strictObject({ upTo: idSchema });
