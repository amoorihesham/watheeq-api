import type express from "express";
import type { Db } from "../db/pool.js";
import { TENANT_COOKIE } from "../modules/auth/shared/cookies.js";
import {
  resolveUserSession,
  touchSession,
  type UserIdentity,
} from "../modules/auth/tenant/tenant-store.js";
import { LAST_SEEN_RESOLUTION_MS, sessionAuth } from "./session-auth.js";

export interface TenantSessionLifetimes {
  idleTimeoutSeconds: number;
  absoluteLifetimeSeconds: number;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireUser`. `user.tenantId` is the tenant the session belongs to. */
      userAuth?: { sessionId: string; user: UserIdentity };
    }
  }
}

/** Authenticates the tenant realm's session cookie. Built once in `app.ts`. */
export function createRequireUser(
  db: Db,
  lifetimes: TenantSessionLifetimes,
): express.RequestHandler {
  return sessionAuth<UserIdentity>({
    cookieName: TENANT_COOKIE,
    resolve: (tokenHash) => resolveUserSession(db, tokenHash, lifetimes.idleTimeoutSeconds),
    touch: ({ sessionId, principal }) =>
      touchSession(db, principal.tenantId, sessionId, LAST_SEEN_RESOLUTION_MS / 1000),
    attach: (req, { sessionId, principal }) => {
      req.userAuth = { sessionId, user: principal };
    },
  });
}
