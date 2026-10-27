import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf, principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { usersApi } from "./users.endpoints.js";
import type { CallerType, UsersServiceType } from "./users.types.js";

const callerOf = (req: Request): CallerType => {
  const { id, userName } = principalOf(req);
  return { id, userName };
};
const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createUsersController({ service }: { service: UsersServiceType }) {
  return {
    list: (async ({ query }, req) =>
      service.list(tenantOf(req), callerOf(req).id, query)) satisfies HandlerOf<
      typeof usersApi.endpoints.list
    >,

    invite: (async ({ body }, req) =>
      service.invite(
        tenantOf(req),
        body,
        callerOf(req),
        auditContextOf(req),
        req.log,
      )) satisfies HandlerOf<typeof usersApi.endpoints.invite>,

    get: (async ({ params }, req) =>
      service.get(tenantOf(req), callerOf(req).id, params.userId)) satisfies HandlerOf<
      typeof usersApi.endpoints.get
    >,

    update: (async ({ params, body }, req) =>
      service.update(tenantOf(req), params.userId, body, auditContextOf(req))) satisfies HandlerOf<
      typeof usersApi.endpoints.update
    >,

    assignRole: (async ({ params, body }, req) =>
      service.assignRole(
        tenantOf(req),
        params.userId,
        body,
        callerOf(req),
        auditContextOf(req),
      )) satisfies HandlerOf<typeof usersApi.endpoints.assignRole>,

    deactivate: (async ({ params }, req) =>
      service.deactivate(
        tenantOf(req),
        params.userId,
        callerOf(req),
        auditContextOf(req),
      )) satisfies HandlerOf<typeof usersApi.endpoints.deactivate>,

    reactivate: (async ({ params }, req) =>
      service.reactivate(
        tenantOf(req),
        params.userId,
        callerOf(req),
        auditContextOf(req),
      )) satisfies HandlerOf<typeof usersApi.endpoints.reactivate>,

    resendInvitation: (async ({ params }, req) => {
      await service.resendInvitation(
        tenantOf(req),
        params.userId,
        callerOf(req),
        auditContextOf(req),
      );
    }) satisfies HandlerOf<typeof usersApi.endpoints.resendInvitation>,
  };
}
