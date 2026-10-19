import type express from "express";
import { AppError } from "../http/errors.js";
import { TENANT_COOKIE } from "../modules/auth/shared/cookies.js";
import type {
  TenantAuthService,
  UserIdentity,
} from "../modules/auth/tenant/tenant-auth.service.js";
import { sessionAuth } from "./session-auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireUser`. `user.tenantId` is the tenant the session belongs to. Read it through `userPrincipal`. */
      userAuth?: { sessionId: string; user: UserIdentity };
    }
  }
}

/** Authenticates the tenant realm's session cookie. Built once in `app.ts`. */
export function createRequireUser(service: TenantAuthService): express.RequestHandler {
  return sessionAuth<UserIdentity>({
    cookieName: TENANT_COOKIE,
    resolve: (tokenHash) => service.resolveSession(tokenHash),
    touch: ({ sessionId, principal }) => service.touchSession(principal.tenantId, sessionId),
    attach: (req, { sessionId, principal }) => {
      req.userAuth = { sessionId, user: principal };
    },
  });
}

/** The authenticated user and session of this request. Only valid behind `requireUser`. */
export function userPrincipal(req: express.Request): NonNullable<express.Request["userAuth"]> {
  if (!req.userAuth) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.userAuth;
}
