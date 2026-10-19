import type express from "express";
import type { Db } from "../db/pool.js";
import {
  type OperatorIdentity,
  resolveOperatorSession,
  touchSession,
} from "../modules/auth/operator/operator-store.js";
import { OPERATOR_COOKIE } from "../modules/auth/shared/cookies.js";
import { LAST_SEEN_RESOLUTION_MS, sessionAuth } from "./session-auth.js";

export interface OperatorSessionLifetimes {
  idleTimeoutSeconds: number;
  absoluteLifetimeSeconds: number;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireOperator`. */
      operatorAuth?: { sessionId: string; operator: OperatorIdentity };
    }
  }
}

/** Authenticates the operator realm's session cookie. Built once in `app.ts`. */
export function createRequireOperator(
  db: Db,
  lifetimes: OperatorSessionLifetimes,
): express.RequestHandler {
  return sessionAuth<OperatorIdentity>({
    cookieName: OPERATOR_COOKIE,
    resolve: (tokenHash) => resolveOperatorSession(db, tokenHash, lifetimes.idleTimeoutSeconds),
    touch: ({ sessionId }) => touchSession(db, sessionId, LAST_SEEN_RESOLUTION_MS / 1000),
    attach: (req, { sessionId, principal }) => {
      req.operatorAuth = { sessionId, operator: principal };
    },
  });
}
