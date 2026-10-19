import type express from "express";
import { AppError } from "../http/errors.js";
import type {
  OperatorAuthService,
  OperatorIdentity,
} from "../modules/auth/operator/operator-auth.service.js";
import { OPERATOR_COOKIE } from "../modules/auth/shared/cookies.js";
import { sessionAuth } from "./session-auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireOperator`. Read it through `operatorPrincipal`. */
      operatorAuth?: { sessionId: string; operator: OperatorIdentity };
    }
  }
}

/** Authenticates the operator realm's session cookie. Built once in `app.ts`. */
export function createRequireOperator(service: OperatorAuthService): express.RequestHandler {
  return sessionAuth<OperatorIdentity>({
    cookieName: OPERATOR_COOKIE,
    resolve: (tokenHash) => service.resolveSession(tokenHash),
    touch: ({ sessionId }) => service.touchSession(sessionId),
    attach: (req, { sessionId, principal }) => {
      req.operatorAuth = { sessionId, operator: principal };
    },
  });
}

/** The authenticated operator and session of this request. Only valid behind `requireOperator`. */
export function operatorPrincipal(
  req: express.Request,
): NonNullable<express.Request["operatorAuth"]> {
  if (!req.operatorAuth) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.operatorAuth;
}
