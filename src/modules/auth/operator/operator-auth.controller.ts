import type express from "express";
import { operatorPrincipal } from "../../../middleware/require-operator.js";
import { clearSessionCookie, OPERATOR_COOKIE, setSessionCookie } from "../shared/cookies.js";
import { readLoginRequest } from "../shared/login-request.js";
import { csrfTokenFromSessionCookie } from "../shared/session-csrf.js";
import type { OperatorAuthService } from "./operator-auth.service.js";

export function createOperatorAuthController({ service }: { service: OperatorAuthService }) {
  return {
    login: (async (req, res) => {
      const { operator, sessionToken, csrfToken } = await service.login(
        readLoginRequest(req, OPERATOR_COOKIE),
        req.log,
      );

      setSessionCookie(res, OPERATOR_COOKIE, sessionToken);
      req.log.info({ operatorId: operator.id }, "operator logged in");
      res.json({ operator, csrfToken });
    }) satisfies express.RequestHandler,

    logout: (async (req, res) => {
      const auth = operatorPrincipal(req);
      await service.logout(auth.sessionId);
      clearSessionCookie(res, OPERATOR_COOKIE);
      req.log.info({ operatorId: auth.operator.id }, "operator logged out");
      res.status(204).end();
    }) satisfies express.RequestHandler,

    session: ((req, res) => {
      const auth = operatorPrincipal(req);
      res.json({
        operator: auth.operator,
        csrfToken: csrfTokenFromSessionCookie(req, OPERATOR_COOKIE),
      });
    }) satisfies express.RequestHandler,
  };
}

export type OperatorAuthController = ReturnType<typeof createOperatorAuthController>;
