import type { TenantMemberRoleType } from "@/modules/auth/auth.types.js";

// The permissions Phase 2 routes declare; Phase 3 grows this into the tenant permission catalog.
export const TENANT_PERMISSIONS = [
  "org.view",
  "org.manage",
  "user.view",
  "user.create",
  "user.update",
  "user.deactivate",
  "subscription.view",
] as const;

// Until Phase 3 puts tenant-defined roles in the token, permissions come from the membership role (Phase 2 spec, P2.9).
export const INTERIM_PERMISSIONS_BY_ROLE: Record<
  TenantMemberRoleType,
  readonly (typeof TENANT_PERMISSIONS)[number][]
> = {
  admin: TENANT_PERMISSIONS,
  member: ["org.view", "user.view"],
};
