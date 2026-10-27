import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { positionsApi } from "./positions.endpoints.js";
import type { PositionsServiceType } from "./positions.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createPositionsController({ service }: { service: PositionsServiceType }) {
  return {
    list: (async ({ query }, req) => service.list(tenantOf(req), query)) satisfies HandlerOf<
      typeof positionsApi.endpoints.list
    >,

    get: (async ({ params }, req) =>
      service.get(tenantOf(req), params.positionId)) satisfies HandlerOf<
      typeof positionsApi.endpoints.get
    >,

    create: (async ({ body }, req) =>
      service.create(tenantOf(req), body, auditContextOf(req))) satisfies HandlerOf<
      typeof positionsApi.endpoints.create
    >,

    rename: (async ({ params, body }, req) =>
      service.rename(
        tenantOf(req),
        params.positionId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof positionsApi.endpoints.rename>,

    setHolders: (async ({ params, body }, req) =>
      service.setHolders(
        tenantOf(req),
        params.positionId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof positionsApi.endpoints.setHolders>,

    retire: (async ({ params }, req) =>
      service.retire(tenantOf(req), params.positionId, auditContextOf(req))) satisfies HandlerOf<
      typeof positionsApi.endpoints.retire
    >,

    restore: (async ({ params }, req) =>
      service.restore(tenantOf(req), params.positionId, auditContextOf(req))) satisfies HandlerOf<
      typeof positionsApi.endpoints.restore
    >,
  };
}
