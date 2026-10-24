import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  EscalationServiceType,
  GetEscalationResponseType,
  PutEscalationResponseType,
} from "./escalation.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createEscalationController({ service }: { service: EscalationServiceType }) {
  return {
    get: (async (req, res) => {
      const escalation = await service.get(tenantOf(req));
      res.status(200).json(escalation satisfies GetEscalationResponseType);
    }) satisfies RequestHandler,

    put: (async (req, res) => {
      const escalation = await service.put(tenantOf(req), req.body, auditContextOf(req));
      res.status(200).json(escalation satisfies PutEscalationResponseType);
    }) satisfies RequestHandler,
  };
}
