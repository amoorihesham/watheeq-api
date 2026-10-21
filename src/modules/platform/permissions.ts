import type { PlatformPermissionsOfType, PlatformPermissionType } from "./platform.types.js";

// The `platform.` prefix keeps these out of the tenant catalog, so a tenant role can never hold one (Phase 1 spec, P1.13).
export const PLATFORM_PERMISSIONS = [
  "platform.plan.view",
  "platform.plan.create",
  "platform.plan.update",
  "platform.tenant.view",
  "platform.tenant.create",
  "platform.subscription.update",
] as const;

const ALL_PLATFORM_PERMISSIONS: ReadonlySet<PlatformPermissionType> = new Set(PLATFORM_PERMISSIONS);

// The MVP has one kind of operator, so every operator holds every platform permission (Phase 1 spec 4.2).
export const platformPermissionsOf: PlatformPermissionsOfType = () => ALL_PLATFORM_PERMISSIONS;
