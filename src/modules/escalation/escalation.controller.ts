import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { escalationApi } from "./escalation.endpoints.js";
import type { EscalationServiceType } from "./escalation.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createEscalationController({ service }: { service: EscalationServiceType }) {
  return {
    get: (async (_input, req) => service.get(tenantOf(req))) satisfies HandlerOf<
      typeof escalationApi.endpoints.get
    >,

    put: (async ({ body }, req) =>
      service.put(tenantOf(req), body, auditContextOf(req))) satisfies HandlerOf<
      typeof escalationApi.endpoints.put
    >,
  };
}
