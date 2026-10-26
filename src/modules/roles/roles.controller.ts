import type { Request, RequestHandler } from "express";
import { sendData, sendNoContent, sendPage } from "@/http/respond.js";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { permissionResponseSchema, roleResponseSchema } from "./roles.responses.js";
import type { RolesServiceType } from "./roles.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const actorOf = (req: Request) => principalOf(req).id;
const roleIdOf = (req: Request) => String(req.params.roleId);

export function createRolesController({ service }: { service: RolesServiceType }) {
  return {
    permissions: ((req, res) => {
      sendPage(res, permissionResponseSchema, service.permissions(req.query));
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      sendPage(res, roleResponseSchema, await service.list(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const role = await service.get(tenantOf(req), roleIdOf(req));
      sendData(res, 200, roleResponseSchema, role);
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const role = await service.create(tenantOf(req), actorOf(req), req.body, auditContextOf(req));
      sendData(res, 201, roleResponseSchema, role);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const role = await service.update(
        tenantOf(req),
        roleIdOf(req),
        actorOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, roleResponseSchema, role);
    }) satisfies RequestHandler,

    delete: (async (req, res) => {
      await service.delete(tenantOf(req), roleIdOf(req), actorOf(req), auditContextOf(req));
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
