import type { AuthUserType } from "@/modules/auth/auth.types.js";
import type { TENANT_PERMISSIONS } from "./tenant-access.config.js";

export type TenantPermissionType = (typeof TENANT_PERMISSIONS)[number];

export type TenantPermissionsOfType = (user: AuthUserType) => ReadonlySet<string>;
