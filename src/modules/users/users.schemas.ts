import { z } from "zod";
import { booleanFilter, idFilter, optionalText, pageQuery, valueFilter } from "@/http/filters.js";
import { idSchema, NO_FIELDS } from "@/http/validate.js";
import { emailSchema, userNameSchema } from "@/modules/auth/index.js";
import { MAX_USER_SEARCH_LENGTH, USER_STATUSES } from "./users.config.js";

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
  unitId: idFilter({ none: true }),
  managers: booleanFilter("all"),
  roleId: idFilter({ none: false }),
  status: valueFilter(USER_STATUSES, "active"),
  q: optionalText(MAX_USER_SEARCH_LENGTH).default(null),
  ...pageQuery,
});
