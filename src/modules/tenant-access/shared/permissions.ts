import { PERMISSION_CATALOG, TENANT_PERMISSIONS } from "../tenant-access.config.js";
import type {
  GrantType,
  TenantPermissionsOfType,
  TenantPermissionType,
} from "../tenant-access.types.js";

const NO_PERMISSIONS: ReadonlySet<string> = new Set();

/** The permissions in the access token, which login and refresh read from the user's role (R3.13). */
export const tenantPermissionsOf: TenantPermissionsOfType = (user) =>
  user.tenant ? new Set(user.tenant.permissions) : NO_PERMISSIONS;

/**
 * The catalog keys a role grants, in catalog order. The system role grants all of them, so permissions added by
 * later phases reach it with no data change (P3.8); a stored key no longer in the catalog is ignored.
 */
export function grantedPermissions(role: {
  isSystem: boolean;
  permissions: readonly string[];
}): TenantPermissionType[] {
  if (role.isSystem) {
    return TENANT_PERMISSIONS;
  }
  const stored = new Set(role.permissions);
  return TENANT_PERMISSIONS.filter((key) => stored.has(key));
}

/** What the system role grants: every permission at its widest scope, the last one the catalog lists. */
export const systemRoleGrants = (): GrantType[] =>
  TENANT_PERMISSIONS.map((key) => ({
    key,
    scope: PERMISSION_CATALOG[key].at(-1) ?? "organization",
  }));
