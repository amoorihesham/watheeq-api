import type { RequestHandler } from "express";
import { AppError } from "@/http/errors.js";
import type { TenantPermissionsOfType, TenantPermissionType } from "../tenant-access.types.js";
import { tenantPermissionsOf } from "./permissions.js";

/**
 * Mount after `authenticate()`; every tenant route declares one (R2.20). An operator holds no tenant permission,
 * so this refuses them on its own as well. Reads `req.auth` directly, like `subscriptionGuard`, so modules that
 * auth imports can use it without an import cycle.
 */
export function requireTenantPermission(
  permission: TenantPermissionType,
  permissionsOf: TenantPermissionsOfType = tenantPermissionsOf,
): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      throw new AppError("UNAUTHENTICATED");
    }
    if (!permissionsOf(req.auth).has(permission)) {
      throw new AppError("FORBIDDEN");
    }
    next();
  };
}
