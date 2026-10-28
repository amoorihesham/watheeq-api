import type { HandlerOf } from '@/http/endpoint.js';
import { auditContextOf } from '@/modules/auth/index.js';
import type { tenantsApi } from './tenants.endpoints.js';
import type { TenantsServiceType } from './tenants.types.js';

export function createTenantsController({ service }: { service: TenantsServiceType }) {
  return {
    create: (async ({ body }, req) => {
      const created = await service.create(body, auditContextOf(req), req.log);
      req.log.info({ tenantId: created.tenant.id }, 'tenant created');
      return created;
    }) satisfies HandlerOf<typeof tenantsApi.endpoints.create>,

    list: (async ({ query }) => service.list(query)) satisfies HandlerOf<typeof tenantsApi.endpoints.list>,

    get: (async ({ params }) => service.get(params.tenantId)) satisfies HandlerOf<typeof tenantsApi.endpoints.get>,

    changeSubscription: (async ({ params, body }, req) => service.changeSubscription(params.tenantId, body, auditContextOf(req))) satisfies HandlerOf<typeof tenantsApi.endpoints.changeSubscription>,

    resendVerification: (async ({ params }, req) => {
      await service.resendVerification(params.tenantId, auditContextOf(req));
    }) satisfies HandlerOf<typeof tenantsApi.endpoints.resendVerification>,
  };
}
