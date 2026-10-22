export {
  assertGrantsHeld,
  grantListOf,
  grantMapOf,
  loadMemberGrants,
  loadRoleGrants,
  missingGrants,
} from "./shared/grants.js";
export { requireTenantPermission } from "./shared/middlewares.js";
export { grantedPermissions, systemRoleGrants, tenantPermissionsOf } from "./shared/permissions.js";
export { withinScope } from "./shared/scopes.js";
export {
  PERMISSION_CATALOG,
  PERMISSION_SCOPES,
  SYSTEM_ROLE_NAME,
  TENANT_PERMISSIONS,
} from "./tenant-access.config.js";
export type {
  GrantMapType,
  GrantType,
  PermissionScopeType,
  TenantPermissionsOfType,
  TenantPermissionType,
} from "./tenant-access.types.js";
