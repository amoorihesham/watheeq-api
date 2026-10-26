import type { RequestHandler } from "express";
import { sendData, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { planResponseSchema } from "./plans.responses.js";
import type { PlansServiceType } from "./plans.types.js";

export function createPlansController({ service }: { service: PlansServiceType }) {
  return {
    create: (async (req, res) => {
      const plan = await service.create(req.body, auditContextOf(req));
      sendData(res, 201, planResponseSchema, plan);
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      sendPage(res, planResponseSchema, await service.list(req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const plan = await service.get(String(req.params.planId));
      sendData(res, 200, planResponseSchema, plan);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const plan = await service.update(String(req.params.planId), req.body, auditContextOf(req));
      sendData(res, 200, planResponseSchema, plan);
    }) satisfies RequestHandler,
  };
}
