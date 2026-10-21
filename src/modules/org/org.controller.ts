import type { RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { GetOrgTreeResponseType, OrgServiceType, UnitResponseType } from "./org.types.js";

export function createOrgController({ service }: { service: OrgServiceType }) {
  return {
    tree: (async (req, res) => {
      const tree = await service.tree(subscriptionOf(req).tenantId);
      res.status(200).json(tree satisfies GetOrgTreeResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const unit = await service.create(
        subscriptionOf(req).tenantId,
        req.body,
        auditContextOf(req),
      );
      res.status(201).json({ unit } satisfies UnitResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const unit = await service.update(
        subscriptionOf(req).tenantId,
        String(req.params.unitId),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ unit } satisfies UnitResponseType);
    }) satisfies RequestHandler,

    delete: (async (req, res) => {
      await service.delete(
        subscriptionOf(req).tenantId,
        String(req.params.unitId),
        auditContextOf(req),
      );
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
