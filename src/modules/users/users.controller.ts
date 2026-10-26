import type { Request, RequestHandler } from "express";
import { sendData, sendNoContent, sendPage } from "@/http/respond.js";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import { userResponseSchema } from "./users.responses.js";
import type { CallerType, UsersServiceType } from "./users.types.js";

const callerOf = (req: Request): CallerType => {
  const { id, userName } = principalOf(req);
  return { id, userName };
};
const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const userIdOf = (req: Request) => String(req.params.userId);

export function createUsersController({ service }: { service: UsersServiceType }) {
  return {
    list: (async (req, res) => {
      const page = await service.list(tenantOf(req), callerOf(req).id, req.query);
      sendPage(res, userResponseSchema, page);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const user = await service.get(tenantOf(req), callerOf(req).id, userIdOf(req));
      sendData(res, 200, userResponseSchema, user);
    }) satisfies RequestHandler,

    invite: (async (req, res) => {
      const user = await service.invite(
        tenantOf(req),
        req.body,
        callerOf(req),
        auditContextOf(req),
        req.log,
      );
      sendData(res, 201, userResponseSchema, user);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const user = await service.update(
        tenantOf(req),
        userIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, userResponseSchema, user);
    }) satisfies RequestHandler,

    assignRole: (async (req, res) => {
      const user = await service.assignRole(
        tenantOf(req),
        userIdOf(req),
        req.body,
        callerOf(req),
        auditContextOf(req),
      );
      sendData(res, 200, userResponseSchema, user);
    }) satisfies RequestHandler,

    deactivate: (async (req, res) => {
      const user = await service.deactivate(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      sendData(res, 200, userResponseSchema, user);
    }) satisfies RequestHandler,

    reactivate: (async (req, res) => {
      const user = await service.reactivate(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      sendData(res, 200, userResponseSchema, user);
    }) satisfies RequestHandler,

    resendInvitation: (async (req, res) => {
      await service.resendInvitation(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
