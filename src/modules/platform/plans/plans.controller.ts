import type { HandlerOf } from '@/http/endpoint.js';
import { auditContextOf } from '@/modules/auth/index.js';
import type { plansApi } from './plans.endpoints.js';
import type { PlansServiceType } from './plans.types.js';

export function createPlansController({ service }: { service: PlansServiceType }) {
  return {
    create: (async ({ body }, req) => service.create(body, auditContextOf(req))) satisfies HandlerOf<typeof plansApi.endpoints.create>,

    list: (async ({ query }) => service.list(query)) satisfies HandlerOf<typeof plansApi.endpoints.list>,

    get: (async ({ params }) => service.get(params.planId)) satisfies HandlerOf<typeof plansApi.endpoints.get>,

    update: (async ({ params, body }, req) => service.update(params.planId, body, auditContextOf(req))) satisfies HandlerOf<typeof plansApi.endpoints.update>,
  };
}
