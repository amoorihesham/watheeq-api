import type { Request, RequestHandler } from "express";
import { sendData } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { escalationResponseSchema } from "./escalation.responses.js";
import type { EscalationServiceType } from "./escalation.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createEscalationController({ service }: { service: EscalationServiceType }) {
  return {
    get: (async (req, res) => {
      sendData(res, 200, escalationResponseSchema, await service.get(tenantOf(req)));
    }) satisfies RequestHandler,

    put: (async (req, res) => {
      const escalation = await service.put(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 200, escalationResponseSchema, escalation);
    }) satisfies RequestHandler,
  };
}
