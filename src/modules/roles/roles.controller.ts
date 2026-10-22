import type { Request, RequestHandler } from "express";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  ListPermissionsResponseType,
  ListRolesResponseType,
  RoleResponseType,
  RolesServiceType,
} from "./roles.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const actorOf = (req: Request) => principalOf(req).id;
const roleIdOf = (req: Request) => String(req.params.roleId);

export function createRolesController({ service }: { service: RolesServiceType }) {
  return {
    permissions: ((_req, res) => {
      res.status(200).json(service.permissions() satisfies ListPermissionsResponseType);
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      const roles = await service.list(tenantOf(req));
      res.status(200).json(roles satisfies ListRolesResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const role = await service.get(tenantOf(req), roleIdOf(req));
      res.status(200).json({ role } satisfies RoleResponseType);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const role = await service.create(tenantOf(req), actorOf(req), req.body, auditContextOf(req));
      res.status(201).json({ role } satisfies RoleResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const role = await service.update(
        tenantOf(req),
        roleIdOf(req),
        actorOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ role } satisfies RoleResponseType);
    }) satisfies RequestHandler,

    delete: (async (req, res) => {
      await service.delete(tenantOf(req), roleIdOf(req), actorOf(req), auditContextOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
