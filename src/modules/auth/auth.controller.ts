import type { RequestHandler } from "express";
import { AppError } from "@/http/errors.js";
import { REFRESH_COOKIE } from "./auth.config.js";
import type {
  AuthServiceType,
  AuthSettingsType,
  LoginResponseType,
  MeResponseType,
  RefreshResponseType,
} from "./auth.types.js";
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
      res.status(200).json({ user: session.user } satisfies LoginResponseType);
    }) satisfies RequestHandler,

    refresh: (async (req, res) => {
      const session = await service.refresh(refreshCookieOf(req.cookies));
      if (!session) {
        clearAuthCookies(res);
        throw new AppError("UNAUTHENTICATED");
      }
      setAuthCookies(res, session.tokens, settings);
      res.status(200).json({ user: session.user } satisfies RefreshResponseType);
    }) satisfies RequestHandler,

    logout: (async (req, res) => {
      await service.logout(refreshCookieOf(req.cookies));
      clearAuthCookies(res);
      req.log.info("user logged out");
      res.status(204).end();
    }) satisfies RequestHandler,

    verifyEmail: (async (req, res) => {
      await service.verifyEmail(req.body, String(req.id));
      req.log.info("email verified");
      res.status(204).end();
    }) satisfies RequestHandler,

    me: (async (req, res) => {
      res.status(200).json((await service.me(principalOf(req))) satisfies MeResponseType);
    }) satisfies RequestHandler,
  };
}
