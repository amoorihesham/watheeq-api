import type { PermissionScopeType, TenantPermissionType } from "./tenant-access.types.js";

/** Narrowest first: a grant covers another when its scope is the same or comes later (P3.3). */
export const PERMISSION_SCOPES = [
  "own",
  "section",
  "department",
  "organization",
] as const satisfies readonly PermissionScopeType[];

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
