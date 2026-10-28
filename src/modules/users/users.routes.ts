import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createUsersController } from './users.controller.js';
import { usersApi } from './users.endpoints.js';
import { createUsersRepository } from './users.repository.js';
import { createUsersService } from './users.service.js';
import type { UsersRouterDepsType } from './users.types.js';

/** The users module's composition root; its router is built from `usersApi` and mounted at its prefix. */
export function createUsersRouter({ db, auth, frontend, emailSender }: UsersRouterDepsType): Router {
  const service = createUsersService({
    db,
    repo: createUsersRepository(),
    emailSender,
    settings: {
      appBaseUrl: frontend.appUrl,
      invitationTtlSeconds: auth.verificationTokenTTL,
    },
  });
  const controller = createUsersController({ service });

  return buildRouter(usersApi, controller, { db, jwtSecret: auth.jwt });
}
