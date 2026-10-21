import type { TenantMemberRoleType } from "@/modules/auth/auth.types.js";
import { INTERIM_PERMISSIONS_BY_ROLE } from "../tenant-access.config.js";
import type { TenantPermissionsOfType } from "../tenant-access.types.js";

const NO_PERMISSIONS: ReadonlySet<string> = new Set();

const isMemberRole = (name: string): name is TenantMemberRoleType =>
  Object.hasOwn(INTERIM_PERMISSIONS_BY_ROLE, name);

/**
 * A token with a `roleId` carries its role's permissions (Phase 3). Until then `roleId` is null and `roleName` is
 * the membership enum (P0.18), which the interim table maps to permissions. Phase 3 removes the fallback.
 */
export const tenantPermissionsOf: TenantPermissionsOfType = (user) => {
  const { tenant } = user;
  if (!tenant) {
    return NO_PERMISSIONS;
  }
  if (tenant.roleId !== null) {
    return new Set(tenant.permissions);
  }
  return isMemberRole(tenant.roleName)
    ? new Set(INTERIM_PERMISSIONS_BY_ROLE[tenant.roleName])
    : NO_PERMISSIONS;
};
