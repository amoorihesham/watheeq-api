import type { RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import type {
  CreatePlanResponseType,
  GetPlanResponseType,
  ListPlansResponseType,
  PlansServiceType,
  UpdatePlanResponseType,
} from "./plans.types.js";

export function createPlansController({ service }: { service: PlansServiceType }) {
  return {
    create: (async (req, res) => {
      const plan = await service.create(req.body, auditContextOf(req));
      res.status(201).json({ plan } satisfies CreatePlanResponseType);
    }) satisfies RequestHandler,

    list: (async (_req, res) => {
      res.status(200).json({ plans: await service.list() } satisfies ListPlansResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const plan = await service.get(String(req.params.planId));
      res.status(200).json({ plan } satisfies GetPlanResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const plan = await service.update(String(req.params.planId), req.body, auditContextOf(req));
      res.status(200).json({ plan } satisfies UpdatePlanResponseType);
    }) satisfies RequestHandler,
  };
}
