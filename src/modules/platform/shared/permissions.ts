import { PLATFORM_PERMISSIONS } from "../platform.config.js";
import type { PlatformPermissionsOfType, PlatformPermissionType } from "../platform.types.js";

const ALL_PLATFORM_PERMISSIONS: ReadonlySet<PlatformPermissionType> = new Set(PLATFORM_PERMISSIONS);
const NO_PLATFORM_PERMISSIONS: ReadonlySet<PlatformPermissionType> = new Set();

// The MVP has one kind of operator, so every operator holds every platform permission (Phase 1 spec, 4.2).
// Operator roles (after the MVP) change only this function, never the routes.
export const platformPermissionsOf: PlatformPermissionsOfType = (user) =>
  user.role === "operator" ? ALL_PLATFORM_PERMISSIONS : NO_PLATFORM_PERMISSIONS;
