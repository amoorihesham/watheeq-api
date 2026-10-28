import type { Request } from 'express';
import type { HandlerOf } from '@/http/endpoint.js';
import { auditContextOf, principalOf } from '@/modules/auth/index.js';
import { subscriptionOf } from '@/modules/subscriptions/index.js';
import type { permissionsApi, rolesApi } from './roles.endpoints.js';
import type { RolesServiceType } from './roles.types.js';

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const actorOf = (req: Request) => principalOf(req).id;

export function createRolesController({ service }: { service: RolesServiceType }) {
  return {
    roles: {
      list: (async ({ query }, req) => service.list(tenantOf(req), query)) satisfies HandlerOf<typeof rolesApi.endpoints.list>,

      get: (async ({ params }, req) => service.get(tenantOf(req), params.roleId)) satisfies HandlerOf<typeof rolesApi.endpoints.get>,

      create: (async ({ body }, req) => service.create(tenantOf(req), actorOf(req), body, auditContextOf(req))) satisfies HandlerOf<typeof rolesApi.endpoints.create>,

      update: (async ({ params, body }, req) => service.update(tenantOf(req), params.roleId, actorOf(req), body, auditContextOf(req))) satisfies HandlerOf<typeof rolesApi.endpoints.update>,

      delete: (async ({ params }, req) => {
        await service.delete(tenantOf(req), params.roleId, actorOf(req), auditContextOf(req));
      }) satisfies HandlerOf<typeof rolesApi.endpoints.delete>,
    },

    permissions: {
      list: (async ({ query }) => service.permissions(query)) satisfies HandlerOf<typeof permissionsApi.endpoints.list>,
    },
  };
}
