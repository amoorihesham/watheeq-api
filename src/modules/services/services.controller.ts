import type { Request, RequestHandler } from "express";
import { sendData, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { serviceResponseSchema } from "./services.responses.js";
import type { ServicesServiceType } from "./services.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const serviceIdOf = (req: Request) => String(req.params.serviceId);

export function createServicesController({ service }: { service: ServicesServiceType }) {
  return {
    list: (async (req, res) => {
      sendPage(res, serviceResponseSchema, await service.list(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const found = await service.get(tenantOf(req), serviceIdOf(req));
      sendData(res, 200, serviceResponseSchema, found);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const created = await service.create(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 201, serviceResponseSchema, created);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const updated = await service.update(
        tenantOf(req),
        serviceIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, serviceResponseSchema, updated);
    }) satisfies RequestHandler,

    updateForm: (async (req, res) => {
      const updated = await service.updateForm(
        tenantOf(req),
        serviceIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, serviceResponseSchema, updated);
    }) satisfies RequestHandler,

    retire: (async (req, res) => {
      const retired = await service.retire(tenantOf(req), serviceIdOf(req), auditContextOf(req));
      sendData(res, 200, serviceResponseSchema, retired);
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const restored = await service.restore(tenantOf(req), serviceIdOf(req), auditContextOf(req));
      sendData(res, 200, serviceResponseSchema, restored);
    }) satisfies RequestHandler,
  };
}
