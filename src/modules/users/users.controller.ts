import type { Request, RequestHandler } from "express";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  CallerType,
  ListUsersResponseType,
  UserResponseType,
  UsersServiceType,
} from "./users.types.js";

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
      res.status(200).json(page satisfies ListUsersResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const user = await service.get(tenantOf(req), callerOf(req).id, userIdOf(req));
      res.status(200).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    invite: (async (req, res) => {
      const user = await service.invite(
        tenantOf(req),
        req.body,
        callerOf(req),
        auditContextOf(req),
        req.log,
      );
      res.status(201).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const user = await service.update(
        tenantOf(req),
        userIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    assignRole: (async (req, res) => {
      const user = await service.assignRole(
        tenantOf(req),
        userIdOf(req),
        req.body,
        callerOf(req),
        auditContextOf(req),
      );
      res.status(200).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    deactivate: (async (req, res) => {
      const user = await service.deactivate(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      res.status(200).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    reactivate: (async (req, res) => {
      const user = await service.reactivate(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      res.status(200).json({ user } satisfies UserResponseType);
    }) satisfies RequestHandler,

    resendInvitation: (async (req, res) => {
      await service.resendInvitation(
        tenantOf(req),
        userIdOf(req),
        callerOf(req),
        auditContextOf(req),
      );
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
