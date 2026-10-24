import { z } from "zod";
import { idSchema, NO_FIELDS } from "@/http/validate.js";
import { emailSchema, userNameSchema } from "@/modules/auth/index.js";
import {
  DEFAULT_USER_PAGE_SIZE,
  MAX_USER_PAGE_SIZE,
  MAX_USER_SEARCH_LENGTH,
  USER_STATUSES,
} from "./users.config.js";

export const userIdSchema = idSchema;

export const inviteUserRequestSchema = z.strictObject({
  email: emailSchema,
  userName: userNameSchema,
  unitId: idSchema.nullable().default(null),
  isManager: z.boolean().default(false),
  roleId: idSchema,
});

export const updateUserRequestSchema = z
  .strictObject({
    userName: userNameSchema,
    unitId: idSchema.nullable(),
    isManager: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

export const assignRoleRequestSchema = z.strictObject({ roleId: idSchema });

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listUsersQuerySchema = z.object({
  // "none" lists the members directly under the organization (P2.13).
  unitId: z.union([idSchema, z.literal("none")]).optional(),
  managers: z.enum(["true", "false"]).optional(),
  roleId: idSchema.optional(),
  status: z.enum([...USER_STATUSES, "all"]).default("active"),
  q: z.string().trim().min(1).max(MAX_USER_SEARCH_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_USER_PAGE_SIZE).default(DEFAULT_USER_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
