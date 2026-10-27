import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { workflowsApi } from "./workflows.endpoints.js";
import type { WorkflowsServiceType } from "./workflows.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createWorkflowsController({ service }: { service: WorkflowsServiceType }) {
  return {
    list: (async ({ query }, req) => service.list(tenantOf(req), query)) satisfies HandlerOf<
      typeof workflowsApi.endpoints.list
    >,

    get: (async ({ params }, req) =>
      service.get(tenantOf(req), params.workflowId)) satisfies HandlerOf<
      typeof workflowsApi.endpoints.get
    >,

    getVersion: (async ({ params }, req) =>
      service.getVersion(tenantOf(req), params.workflowId, params.number)) satisfies HandlerOf<
      typeof workflowsApi.endpoints.getVersion
    >,

    create: (async ({ body }, req) =>
      service.create(tenantOf(req), body, auditContextOf(req))) satisfies HandlerOf<
      typeof workflowsApi.endpoints.create
    >,

    update: (async ({ params, body }, req) =>
      service.update(
        tenantOf(req),
        params.workflowId,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof workflowsApi.endpoints.update>,

    retire: (async ({ params }, req) =>
      service.retire(tenantOf(req), params.workflowId, auditContextOf(req))) satisfies HandlerOf<
      typeof workflowsApi.endpoints.retire
    >,

    restore: (async ({ params }, req) =>
      service.restore(tenantOf(req), params.workflowId, auditContextOf(req))) satisfies HandlerOf<
      typeof workflowsApi.endpoints.restore
    >,
  };
}
