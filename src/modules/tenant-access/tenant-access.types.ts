import type { permissionScopes } from "@/db/schema/index.js";
import type { AuthUserType } from "@/modules/auth/auth.types.js";
import type { PERMISSION_CATALOG } from "./tenant-access.constants.js";

export type TenantPermissionType = keyof typeof PERMISSION_CATALOG;
export type PermissionScopeType = (typeof permissionScopes.enumValues)[number];

/** One permission a role grants, at one scope. */
export interface GrantType {
  key: TenantPermissionType;
  scope: PermissionScopeType;
}

/** What one role holds: each permission it grants, at its scope. */
export type GrantMapType = ReadonlyMap<TenantPermissionType, PermissionScopeType>;

export type TenantPermissionsOfType = (user: AuthUserType) => ReadonlySet<string>;
