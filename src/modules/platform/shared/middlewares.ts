import type { RequestHandler } from 'express';
import { AppError } from '@/http/errors.js';
import { principalOf } from '@/modules/auth/shared/middlewares.js';
import type { PlatformPermissionsOfType, PlatformPermissionType } from '../platform.types.js';
import { platformPermissionsOf } from './permissions.js';

/**
 * Mount after `authenticate()` and `requireRole("operator")`; every operator route declares one (R1.16).
 * A tenant user holds no platform permission, so this refuses them on its own as well.
 */
export function requirePlatformPermission(permission: PlatformPermissionType, permissionsOf: PlatformPermissionsOfType = platformPermissionsOf): RequestHandler {
  return (req, _res, next) => {
    if (!permissionsOf(principalOf(req)).has(permission)) {
      throw new AppError('FORBIDDEN');
    }
    next();
  };
}
