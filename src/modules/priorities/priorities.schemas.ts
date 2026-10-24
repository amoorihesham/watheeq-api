import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import {
  MAX_PRIORITY_DAYS,
  MAX_PRIORITY_NAME_LENGTH,
  MIN_PRIORITY_DAYS,
} from "./priorities.config.js";

const priorityName = z.string().trim().min(1).max(MAX_PRIORITY_NAME_LENGTH);
const days = z.int().min(MIN_PRIORITY_DAYS).max(MAX_PRIORITY_DAYS);

export const priorityIdSchema = z.uuid();

export const createPriorityRequestSchema = z.strictObject({ name: priorityName, days });

export const updatePriorityRequestSchema = z
  .strictObject({ name: priorityName, days })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

// The list itself is checked against the active priorities (`order_mismatch`).
export const reorderPrioritiesRequestSchema = z.strictObject({ ids: z.array(z.string()) });

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listPrioritiesQuerySchema = z.object({
  includeRetired: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
