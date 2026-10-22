import type { PermissionScopeType, TenantPermissionType } from "./tenant-access.types.js";

/**
 * The tenant permission catalog: each permission and the scopes a role may grant it at (Phase 3 spec, P3.1).
 * A permission is added here with the route that requires it; tenants cannot add their own.
 */
export const PERMISSION_CATALOG = {
  "org.view": ["organization"],
  "org.manage": ["organization"],
  "user.view": ["own", "section", "department", "organization"],
  "user.create": ["organization"],
  "user.update": ["organization"],
  "user.deactivate": ["organization"],
  "subscription.view": ["organization"],
  "role.view": ["organization"],
  "role.manage": ["organization"],
  "role.assign": ["organization"],
} as const satisfies Record<string, readonly PermissionScopeType[]>;

export const TENANT_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as TenantPermissionType[];

/** The name the Tenant Admin role is created with; clients label it from `isSystem` (P3.8). */
export const SYSTEM_ROLE_NAME = "Tenant Admin";
