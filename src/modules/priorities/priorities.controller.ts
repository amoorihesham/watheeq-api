import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { prioritiesApi } from "./priorities.endpoints.js";
import type { PrioritiesServiceType } from "./priorities.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createPrioritiesController({ service }: { service: PrioritiesServiceType }) {
  return {
    list: (async ({ query }, req) => service.list(tenantOf(req), query)) satisfies HandlerOf<
      typeof prioritiesApi.endpoints.list
    >,

    create: (async ({ body }, req) =>
      service.create(tenantOf(req), body, auditContextOf(req))) satisfies HandlerOf<
      typeof prioritiesApi.endpoints.create
    >,

    reorder: (async ({ body }, req) => {
      await service.reorder(tenantOf(req), body, auditContextOf(req));
    }) satisfies HandlerOf<typeof prioritiesApi.endpoints.reorder>,

    update: (async ({ params, body }, req) =>
      service.update(
        tenantOf(req),
        params.priorityId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof prioritiesApi.endpoints.update>,

    retire: (async ({ params }, req) =>
      service.retire(tenantOf(req), params.priorityId, auditContextOf(req))) satisfies HandlerOf<
      typeof prioritiesApi.endpoints.retire
    >,

    restore: (async ({ params }, req) =>
      service.restore(tenantOf(req), params.priorityId, auditContextOf(req))) satisfies HandlerOf<
      typeof prioritiesApi.endpoints.restore
    >,
  };
}
