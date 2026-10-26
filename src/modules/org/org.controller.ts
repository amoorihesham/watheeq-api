import type { RequestHandler } from "express";
import { sendData, sendNoContent } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { orgTreeResponseSchema, orgUnitResponseSchema } from "./org.responses.js";
import type { OrgServiceType } from "./org.types.js";

export function createOrgController({ service }: { service: OrgServiceType }) {
  return {
    tree: (async (req, res) => {
      const tree = await service.tree(subscriptionOf(req).tenantId);
      sendData(res, 200, orgTreeResponseSchema, tree);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const unit = await service.create(
        subscriptionOf(req).tenantId,
        req.body,
        auditContextOf(req),
      );
      sendData(res, 201, orgUnitResponseSchema, unit);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const unit = await service.update(
        subscriptionOf(req).tenantId,
        String(req.params.unitId),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, orgUnitResponseSchema, unit);
    }) satisfies RequestHandler,

    delete: (async (req, res) => {
      await service.delete(
        subscriptionOf(req).tenantId,
        String(req.params.unitId),
        auditContextOf(req),
      );
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
