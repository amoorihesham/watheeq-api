import type { RequestHandler } from "express";
import { AppError } from "@/http/errors.js";
import { sendData, sendNoContent } from "@/http/respond.js";
import { REFRESH_COOKIE } from "./auth.constants.js";
import { sessionResponseSchema } from "./auth.responses.js";
import type { AuthServiceType, AuthSettingsType } from "./auth.types.js";
import { clearAuthCookies, setAuthCookies } from "./shared/cookies.js";
import { principalOf } from "./shared/middlewares.js";

const refreshCookieOf = (cookies: Record<string, unknown> | undefined): string | undefined => {
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === "string" ? value : undefined;
};

export function createAuthController({
  service,
  settings,
}: {
  service: AuthServiceType;
  settings: AuthSettingsType;
}) {
  return {
    login: (async (req, res) => {
      const session = await service.login(req.body);
      setAuthCookies(res, session.tokens, settings);
      req.log.info({ userId: session.user.id }, "user logged in");
      sendData(res, 200, sessionResponseSchema, {
        user: session.user,
        subscription: session.subscription,
      });
    }) satisfies RequestHandler,

    refresh: (async (req, res) => {
      const session = await service.refresh(refreshCookieOf(req.cookies));
      if (!session) {
        clearAuthCookies(res);
        throw new AppError("UNAUTHENTICATED");
      }
      setAuthCookies(res, session.tokens, settings);
      sendData(res, 200, sessionResponseSchema, {
        user: session.user,
        subscription: session.subscription,
      });
    }) satisfies RequestHandler,

    logout: (async (req, res) => {
      await service.logout(refreshCookieOf(req.cookies));
      clearAuthCookies(res);
      req.log.info("user logged out");
      sendNoContent(res);
    }) satisfies RequestHandler,

    verifyEmail: (async (req, res) => {
      await service.verifyEmail(req.body, String(req.id));
      req.log.info("email verified");
      sendNoContent(res);
    }) satisfies RequestHandler,

    changePassword: (async (req, res) => {
      await service.changePassword(
        principalOf(req),
        req.body,
        refreshCookieOf(req.cookies),
        String(req.id),
      );
      req.log.info("password changed");
      sendNoContent(res);
    }) satisfies RequestHandler,

    requestPasswordReset: (async (req, res) => {
      const sendLink = service.requestPasswordReset(req.body, req.log);
      sendNoContent(res);
      await sendLink();
    }) satisfies RequestHandler,

    resetPassword: (async (req, res) => {
      await service.resetPassword(req.body, String(req.id));
      req.log.info("password reset");
      sendNoContent(res);
    }) satisfies RequestHandler,

    me: (async (req, res) => {
      sendData(res, 200, sessionResponseSchema, await service.me(principalOf(req)));
    }) satisfies RequestHandler,
  };
}
