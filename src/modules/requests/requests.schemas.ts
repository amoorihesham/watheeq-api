import { z } from "zod";
import { requestStates } from "@/db/schema/index.js";
import { idSchema } from "@/http/validate.js";
import {
  DEFAULT_REQUEST_PAGE_SIZE,
  MAX_REASON_LENGTH,
  MAX_REQUEST_PAGE_SIZE,
  MAX_TITLE_LENGTH,
  REQUEST_VIEWS,
} from "./requests.config.js";

export const requestIdSchema = idSchema;

const reason = z.string().trim().min(1).max(MAX_REASON_LENGTH);

export const submitRequestSchema = z.strictObject({
  serviceId: idSchema,
  priorityId: idSchema,
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  answers: z.record(z.string(), z.unknown()),
  fileIds: z.array(z.string()).optional(),
});

export const changePriorityRequestSchema = z.strictObject({ priorityId: idSchema, reason });
export const acceptRequestSchema = z.strictObject({ handlerId: idSchema, workflowId: idSchema });
export const reasonRequestSchema = z.strictObject({ reason });

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listRequestsQuerySchema = z.object({
  view: z.enum(REQUEST_VIEWS).optional(),
  state: z.enum(requestStates.enumValues).optional(),
  serviceId: idSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_REQUEST_PAGE_SIZE)
    .default(DEFAULT_REQUEST_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
