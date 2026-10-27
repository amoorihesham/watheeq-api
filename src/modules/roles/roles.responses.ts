import { z } from "zod";
import { PERMISSION_SCOPES } from "@/modules/tenant-access/index.js";

const grantResponseSchema = z
  .strictObject({ key: z.string(), scope: z.enum(PERMISSION_SCOPES) })
  .meta({ id: "RoleGrant" });

/** A role as the API returns it; the system role lists its computed grants (P3.8). */
export const roleResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    permissions: z.array(grantResponseSchema),
    /** Users holding the role, active or not: the role can be deleted only at zero (R3.7). */
    memberCount: z.number(),
  })
  .meta({ id: "Role" });

/** One entry of the permission catalog (R3.1). */
export const permissionResponseSchema = z
  .strictObject({
    key: z.string(),
    scopes: z.array(z.enum(PERMISSION_SCOPES)),
  })
  .meta({ id: "Permission" });
