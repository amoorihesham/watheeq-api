import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  ListPrioritiesResponseType,
  PrioritiesServiceType,
  PriorityResponseType,
} from "./priorities.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const priorityIdOf = (req: Request) => String(req.params.priorityId);

export function createPrioritiesController({ service }: { service: PrioritiesServiceType }) {
  return {
    list: (async (req, res) => {
      const priorities = await service.list(tenantOf(req), req.query);
      res.status(200).json(priorities satisfies ListPrioritiesResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const priority = await service.create(tenantOf(req), req.body, auditContextOf(req));
      res.status(201).json({ priority } satisfies PriorityResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const priority = await service.update(
        tenantOf(req),
        priorityIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ priority } satisfies PriorityResponseType);
    }) satisfies RequestHandler,

    reorder: (async (req, res) => {
      const priorities = await service.reorder(tenantOf(req), req.body, auditContextOf(req));
      res.status(200).json(priorities satisfies ListPrioritiesResponseType);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const priority = await service.retire(tenantOf(req), priorityIdOf(req), auditContextOf(req));
      res.status(200).json({ priority } satisfies PriorityResponseType);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const priority = await service.restore(tenantOf(req), priorityIdOf(req), auditContextOf(req));
      res.status(200).json({ priority } satisfies PriorityResponseType);
    }) satisfies RequestHandler,
  };
}
