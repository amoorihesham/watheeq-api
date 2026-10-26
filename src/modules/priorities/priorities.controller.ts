import type { Request, RequestHandler } from "express";
import { sendData, sendNoContent, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { priorityResponseSchema } from "./priorities.responses.js";
import type { PrioritiesServiceType } from "./priorities.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const priorityIdOf = (req: Request) => String(req.params.priorityId);

export function createPrioritiesController({ service }: { service: PrioritiesServiceType }) {
  return {
    list: (async (req, res) => {
      sendPage(res, priorityResponseSchema, await service.list(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const priority = await service.create(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 201, priorityResponseSchema, priority);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const priority = await service.update(
        tenantOf(req),
        priorityIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, priorityResponseSchema, priority);
    }) satisfies RequestHandler,

    reorder: (async (req, res) => {
      await service.reorder(tenantOf(req), req.body, auditContextOf(req));
      sendNoContent(res);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const priority = await service.retire(tenantOf(req), priorityIdOf(req), auditContextOf(req));
      sendData(res, 200, priorityResponseSchema, priority);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const priority = await service.restore(tenantOf(req), priorityIdOf(req), auditContextOf(req));
      sendData(res, 200, priorityResponseSchema, priority);
    }) satisfies RequestHandler,
  };
}
