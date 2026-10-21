import type { RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import type {
  ChangeSubscriptionResponseType,
  CreateTenantResponseType,
  GetTenantResponseType,
  ListTenantsResponseType,
  TenantsServiceType,
} from "./tenants.types.js";

export function createTenantsController({ service }: { service: TenantsServiceType }) {
  return {
    create: (async (req, res) => {
      const created = await service.create(req.body, auditContextOf(req), req.log);
      req.log.info({ tenantId: created.tenant.id }, "tenant created");
      res.status(201).json(created satisfies CreateTenantResponseType);
    }) satisfies RequestHandler,

    list: (async (_req, res) => {
      res.status(200).json({ tenants: await service.list() } satisfies ListTenantsResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const detail = await service.get(String(req.params.tenantId));
      res.status(200).json(detail satisfies GetTenantResponseType);
    }) satisfies RequestHandler,

    changeSubscription: (async (req, res) => {
      const changed = await service.changeSubscription(
        String(req.params.tenantId),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json(changed satisfies ChangeSubscriptionResponseType);
    }) satisfies RequestHandler,

    resendVerification: (async (req, res) => {
      await service.resendVerification(String(req.params.tenantId), auditContextOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
