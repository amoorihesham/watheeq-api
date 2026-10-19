import type express from "express";
import { userPrincipal } from "../../../middleware/require-user.js";
import { clearSessionCookie, setSessionCookie, TENANT_COOKIE } from "../shared/cookies.js";
import { readLoginRequest } from "../shared/login-request.js";
import { csrfTokenFromSessionCookie } from "../shared/session-csrf.js";
import type { TenantAuthService } from "./tenant-auth.service.js";

export function createTenantAuthController({ service }: { service: TenantAuthService }) {
  return {
    login: (async (req, res) => {
      const { user, sessionToken, csrfToken } = await service.login(
        readLoginRequest(req, TENANT_COOKIE),
        req.log,
      );

      setSessionCookie(res, TENANT_COOKIE, sessionToken);
      req.log.info({ userId: user.id, tenantId: user.tenantId }, "tenant user logged in");
      res.json({ user, csrfToken });
    }) satisfies express.RequestHandler,

    logout: (async (req, res) => {
      const auth = userPrincipal(req);
      await service.logout(auth.user.tenantId, auth.sessionId);
      clearSessionCookie(res, TENANT_COOKIE);
      req.log.info(
        { userId: auth.user.id, tenantId: auth.user.tenantId },
        "tenant user logged out",
      );
      res.status(204).end();
    }) satisfies express.RequestHandler,

    session: ((req, res) => {
      const auth = userPrincipal(req);
      res.json({
        user: auth.user,
        csrfToken: csrfTokenFromSessionCookie(req, TENANT_COOKIE),
      });
    }) satisfies express.RequestHandler,
  };
}

export type TenantAuthController = ReturnType<typeof createTenantAuthController>;
