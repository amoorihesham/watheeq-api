import type { Response } from 'express';
import { ACCESS_COOKIE, ACCESS_COOKIE_FLAGS, REFRESH_COOKIE, REFRESH_COOKIE_FLAGS } from '../auth.constants.js';
import type { AuthSettingsType, AuthTokensType } from '../auth.types.js';

export function setAuthCookies(res: Response, tokens: AuthTokensType, settings: AuthSettingsType): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...ACCESS_COOKIE_FLAGS,
    maxAge: settings.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...REFRESH_COOKIE_FLAGS,
    maxAge: settings.refreshTokenTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, ACCESS_COOKIE_FLAGS);
  res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_FLAGS);
}
