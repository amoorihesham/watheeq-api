import type { HandlerOf } from '@/http/endpoint.js';
import { AppError } from '@/http/errors.js';
import { REFRESH_COOKIE } from './auth.constants.js';
import type { authApi } from './auth.endpoints.js';
import type { AuthServiceType, AuthSettingsType } from './auth.types.js';
import { clearAuthCookies, setAuthCookies } from './shared/cookies.js';
import { principalOf } from './shared/middlewares.js';

const refreshCookieOf = (cookies: Record<string, unknown> | undefined): string | undefined => {
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
};

export function createAuthController({ service, settings }: { service: AuthServiceType; settings: AuthSettingsType }) {
  return {
    login: (async ({ body }, req, res) => {
      const session = await service.login(body);
      setAuthCookies(res, session.tokens, settings);
      req.log.info({ userId: session.user.id }, 'user logged in');
      return { user: session.user, subscription: session.subscription };
    }) satisfies HandlerOf<typeof authApi.endpoints.login>,

    refresh: (async (_input, req, res) => {
      const session = await service.refresh(refreshCookieOf(req.cookies));
      if (!session) {
        clearAuthCookies(res);
        throw new AppError('UNAUTHENTICATED');
      }
      setAuthCookies(res, session.tokens, settings);
      return { user: session.user, subscription: session.subscription };
    }) satisfies HandlerOf<typeof authApi.endpoints.refresh>,

    logout: (async (_input, req, res) => {
      await service.logout(refreshCookieOf(req.cookies));
      clearAuthCookies(res);
      req.log.info('user logged out');
    }) satisfies HandlerOf<typeof authApi.endpoints.logout>,

    verifyEmail: (async ({ body }, req) => {
      await service.verifyEmail(body, String(req.id));
      req.log.info('email verified');
    }) satisfies HandlerOf<typeof authApi.endpoints.verifyEmail>,

    me: (async (_input, req) => service.me(principalOf(req))) satisfies HandlerOf<typeof authApi.endpoints.me>,

    changePassword: (async ({ body }, req) => {
      await service.changePassword(principalOf(req), body, refreshCookieOf(req.cookies), String(req.id));
      req.log.info('password changed');
    }) satisfies HandlerOf<typeof authApi.endpoints.changePassword>,

    requestPasswordReset: (async ({ body }, req) => {
      // The 204 does not wait for the lookup, so neither it nor its timing reveals whether the account exists.
      void service.requestPasswordReset(body, req.log)();
    }) satisfies HandlerOf<typeof authApi.endpoints.requestPasswordReset>,

    resetPassword: (async ({ body }, req) => {
      await service.resetPassword(body, String(req.id));
      req.log.info('password reset');
    }) satisfies HandlerOf<typeof authApi.endpoints.resetPassword>,
  };
}
