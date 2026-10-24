import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  ListServicesResponseType,
  ServiceResponseType,
  ServicesServiceType,
} from "./services.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const serviceIdOf = (req: Request) => String(req.params.serviceId);

export function createServicesController({ service }: { service: ServicesServiceType }) {
  return {
    list: (async (req, res) => {
      const services = await service.list(tenantOf(req), req.query);
      res.status(200).json(services satisfies ListServicesResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const found = await service.get(tenantOf(req), serviceIdOf(req));
      res.status(200).json({ service: found } satisfies ServiceResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const created = await service.create(tenantOf(req), req.body, auditContextOf(req));
      res.status(201).json({ service: created } satisfies ServiceResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const updated = await service.update(
        tenantOf(req),
        serviceIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ service: updated } satisfies ServiceResponseType);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const retired = await service.retire(tenantOf(req), serviceIdOf(req), auditContextOf(req));
      res.status(200).json({ service: retired } satisfies ServiceResponseType);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const restored = await service.restore(tenantOf(req), serviceIdOf(req), auditContextOf(req));
      res.status(200).json({ service: restored } satisfies ServiceResponseType);
    }) satisfies RequestHandler,
  };
}
