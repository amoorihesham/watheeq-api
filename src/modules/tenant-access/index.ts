export { requireTenantPermission } from "./shared/middlewares.js";
export { grantedPermissions, systemRoleGrants, tenantPermissionsOf } from "./shared/permissions.js";
export {
  PERMISSION_CATALOG,
  SYSTEM_ROLE_NAME,
  TENANT_PERMISSIONS,
} from "./tenant-access.config.js";
export type {
  GrantType,
  PermissionScopeType,
  TenantPermissionsOfType,
  TenantPermissionType,
} from "./tenant-access.types.js";
