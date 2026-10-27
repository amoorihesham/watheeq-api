import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { orgApi } from "./org.endpoints.js";
import type { OrgServiceType } from "./org.types.js";

export function createOrgController({ service }: { service: OrgServiceType }) {
  return {
    tree: (async (_input, req) => service.tree(subscriptionOf(req).tenantId)) satisfies HandlerOf<
      typeof orgApi.endpoints.tree
    >,

    create: (async ({ body }, req) =>
      service.create(subscriptionOf(req).tenantId, body, auditContextOf(req))) satisfies HandlerOf<
      typeof orgApi.endpoints.create
    >,

    update: (async ({ params, body }, req) =>
      service.update(
        subscriptionOf(req).tenantId,
        params.unitId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof orgApi.endpoints.update>,

    delete: (async ({ params }, req) => {
      await service.delete(subscriptionOf(req).tenantId, params.unitId, auditContextOf(req));
    }) satisfies HandlerOf<typeof orgApi.endpoints.delete>,
  };
}
