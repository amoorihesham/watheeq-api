import type { OperatorIdentity } from "../auth/operator/operator-auth.service.js";

// The `platform.` prefix keeps these out of the tenant catalog, so a tenant role can never hold one (T6).
export const PLATFORM_PERMISSIONS = [
  "platform.plan.view",
  "platform.plan.create",
  "platform.plan.update",
  "platform.tenant.view",
  "platform.tenant.create",
  "platform.subscription.update",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type PlatformPermissionsOf = (operator: OperatorIdentity) => ReadonlySet<PlatformPermission>;

const ALL_PLATFORM_PERMISSIONS: ReadonlySet<PlatformPermission> = new Set(PLATFORM_PERMISSIONS);

// The MVP has one kind of operator, so every operator holds every platform permission (Phase 1 spec 4.2).
export const platformPermissionsOf: PlatformPermissionsOf = () => ALL_PLATFORM_PERMISSIONS;
