// The `platform.` prefix keeps these out of the tenant catalog, so a tenant role can never hold one (Phase 1 spec, P1.13).
export const PLATFORM_PERMISSIONS = ['platform.plan.view', 'platform.plan.create', 'platform.plan.update', 'platform.tenant.view', 'platform.tenant.create', 'platform.subscription.update'] as const;
