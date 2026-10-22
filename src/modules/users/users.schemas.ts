import { z } from "zod";
import { emailSchema, userNameSchema } from "@/modules/auth/index.js";
import {
  DEFAULT_USER_PAGE_SIZE,
  MAX_USER_PAGE_SIZE,
  MAX_USER_SEARCH_LENGTH,
  USER_STATUSES,
} from "./users.config.js";

export const userIdSchema = z.uuid();

export const inviteUserRequestSchema = z.object({
  email: emailSchema,
  userName: userNameSchema,
  unitId: z.uuid().nullable().default(null),
  isManager: z.boolean().default(false),
  roleId: z.uuid(),
});

export const updateUserRequestSchema = z
  .object({
    userName: userNameSchema,
    unitId: z.uuid().nullable(),
    isManager: z.boolean(),
    roleId: z.uuid(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "at least one field" });

export const listUsersQuerySchema = z.object({
  // "none" lists the members directly under the organization (P2.13).
  unitId: z.union([z.uuid(), z.literal("none")]).optional(),
  managers: z.enum(["true", "false"]).optional(),
  roleId: z.uuid().optional(),
  status: z.enum([...USER_STATUSES, "all"]).default("active"),
  q: z.string().trim().min(1).max(MAX_USER_SEARCH_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_USER_PAGE_SIZE).default(DEFAULT_USER_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
