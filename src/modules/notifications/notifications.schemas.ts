import { z } from "zod";
import { pageQuery, valueFilter } from "@/http/filters.js";
import { idSchema } from "@/http/validate.js";

// Query strings stay lenient: links and proxies add parameters the API does not control (T25).
export const listNotificationsQuerySchema = z.object({
  // `true` is unread only, `false` read only.
  unread: valueFilter(["true", "false"], "all"),
  ...pageQuery,
});

export const readAllRequestSchema = z.strictObject({ upTo: idSchema });
