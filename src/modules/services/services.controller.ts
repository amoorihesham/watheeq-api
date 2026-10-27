import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { servicesApi } from "./services.endpoints.js";
import type { ServicesServiceType } from "./services.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createServicesController({ service }: { service: ServicesServiceType }) {
  return {
    list: (async ({ query }, req) => service.list(tenantOf(req), query)) satisfies HandlerOf<
      typeof servicesApi.endpoints.list
    >,

    get: (async ({ params }, req) =>
      service.get(tenantOf(req), params.serviceId)) satisfies HandlerOf<
      typeof servicesApi.endpoints.get
    >,

    create: (async ({ body }, req) =>
      service.create(tenantOf(req), body, auditContextOf(req))) satisfies HandlerOf<
      typeof servicesApi.endpoints.create
    >,

    update: (async ({ params, body }, req) =>
      service.update(
        tenantOf(req),
        params.serviceId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof servicesApi.endpoints.update>,

    updateForm: (async ({ params, body }, req) =>
      service.updateForm(
        tenantOf(req),
        params.serviceId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof servicesApi.endpoints.updateForm>,

    retire: (async ({ params }, req) =>
      service.retire(tenantOf(req), params.serviceId, auditContextOf(req))) satisfies HandlerOf<
      typeof servicesApi.endpoints.retire
    >,

    restore: (async ({ params }, req) =>
      service.restore(tenantOf(req), params.serviceId, auditContextOf(req))) satisfies HandlerOf<
      typeof servicesApi.endpoints.restore
    >,
  };
}
