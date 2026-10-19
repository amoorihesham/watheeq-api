import type express from "express";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import { validate } from "../../../http/validate.js";
import { operatorPrincipal } from "../../../middleware/require-operator.js";
import { clientIp } from "../shared/client-ip.js";
import {
  clearSessionCookie,
  OPERATOR_COOKIE,
  readCookie,
  setSessionCookie,
} from "../shared/cookies.js";
import { csrfTokenFor } from "../shared/csrf.js";
import { hashToken, isWellFormedToken } from "../shared/tokens.js";
import type { OperatorAuthService } from "./operator-auth.service.js";

// Passwords are checked against a 256-character cap before any hashing work (spec section 5).
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});

const USER_AGENT_MAX_LENGTH = 512;

export function createOperatorAuthController({ service }: { service: OperatorAuthService }) {
  return {
    login: (async (req, res) => {
      const { email, password } = validate(loginBody, req.body);
      const ip = clientIp(req);
      const presented = readCookie(req, OPERATOR_COOKIE);
      const presentedTokenHash =
        presented !== undefined && isWellFormedToken(presented) ? hashToken(presented) : undefined;

      const { operator, sessionToken, csrfToken } = await service.login(
        {
          email,
          password,
          ip,
          userAgent: req.get("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH),
          presentedTokenHash,
        },
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

    // The browser app keeps the CSRF token in memory and recovers it here after a reload.
    // It is derived from the session cookie, so it is the same token login returned.
    session: ((req, res) => {
      const auth = operatorPrincipal(req);
      const sessionToken = readCookie(req, OPERATOR_COOKIE);
      if (sessionToken === undefined) {
        throw new AppError("UNAUTHENTICATED");
      }
      res.json({ operator: auth.operator, csrfToken: csrfTokenFor(sessionToken) });
    }) satisfies express.RequestHandler,
  };
}

export type OperatorAuthController = ReturnType<typeof createOperatorAuthController>;
