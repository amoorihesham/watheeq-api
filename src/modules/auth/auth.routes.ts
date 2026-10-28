import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createAuthController } from './auth.controller.js';
import { authApi } from './auth.endpoints.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import type { AuthRouterDepsType, AuthSettingsType } from './auth.types.js';

/** The auth module's composition root: builds repository, service, and controller, and returns the `/auth` router built from its declarations. */
export function createAuthRouter({ db, auth, links, emailSender }: AuthRouterDepsType): Router {
  const settings: AuthSettingsType = {
    jwtSecret: auth.jwtSecret,
    accessTokenTtlSeconds: auth.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: auth.refreshTokenTtlSeconds,
    appBaseUrl: links.appBaseUrl,
    passwordResetTtlSeconds: links.passwordResetTtlSeconds,
  };
  const service = createAuthService({ db, repo: createAuthRepository(), settings, emailSender });
  const controller = createAuthController({ service, settings });

  return buildRouter(authApi, controller, { db, jwtSecret: settings.jwtSecret });
}
