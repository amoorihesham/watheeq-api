import type { RequestHandler } from "express";
import { sendData, sendNoContent, sendPage } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { tenantDetailResponseSchema } from "./tenants.responses.js";
import type { TenantsServiceType } from "./tenants.types.js";

export function createTenantsController({ service }: { service: TenantsServiceType }) {
  return {
    create: (async (req, res) => {
      const created = await service.create(req.body, auditContextOf(req), req.log);
      req.log.info({ tenantId: created.tenant.id }, "tenant created");
      sendData(res, 201, tenantDetailResponseSchema, created);
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      sendPage(res, tenantDetailResponseSchema, await service.list(req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const detail = await service.get(String(req.params.tenantId));
      sendData(res, 200, tenantDetailResponseSchema, detail);
    }) satisfies RequestHandler,

    changeSubscription: (async (req, res) => {
      const changed = await service.changeSubscription(
        String(req.params.tenantId),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, tenantDetailResponseSchema, changed);
    }) satisfies RequestHandler,

    resendVerification: (async (req, res) => {
      await service.resendVerification(String(req.params.tenantId), auditContextOf(req));
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
