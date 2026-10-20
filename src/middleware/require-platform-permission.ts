import type express from "express";
import { AppError } from "../http/errors.js";
import {
  type PlatformPermission,
  type PlatformPermissionsOf,
  platformPermissionsOf,
} from "../modules/platform/permissions.js";
import { operatorPrincipal } from "./require-operator.js";

/** Mount after `requireOperator`. `permissionsOf` is replaceable only so tests can exercise the rejection. */
export function requirePlatformPermission(
  permission: PlatformPermission,
  permissionsOf: PlatformPermissionsOf = platformPermissionsOf,
): express.RequestHandler {
  return (req, _res, next) => {
    const { operator } = operatorPrincipal(req);
    if (!permissionsOf(operator).has(permission)) {
      throw new AppError("FORBIDDEN");
    }
    next();
  };
}
