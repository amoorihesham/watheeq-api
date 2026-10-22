import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import { PERMISSION_SCOPES } from "@/modules/tenant-access/index.js";
import { MAX_ROLE_NAME_LENGTH, MAX_ROLE_PERMISSIONS } from "./roles.config.js";

const roleName = z.string().trim().min(1).max(MAX_ROLE_NAME_LENGTH);

// Keys and scopes are checked against the catalog by the service, so the client gets a precise detail code.
const grants = z
  .array(z.strictObject({ key: z.string(), scope: z.enum(PERMISSION_SCOPES) }))
  .max(MAX_ROLE_PERMISSIONS);

export const roleIdSchema = z.uuid();

export const createRoleRequestSchema = z.strictObject({ name: roleName, permissions: grants });

// `permissions` replaces the whole set.
export const updateRoleRequestSchema = z
  .strictObject({ name: roleName, permissions: grants })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);
