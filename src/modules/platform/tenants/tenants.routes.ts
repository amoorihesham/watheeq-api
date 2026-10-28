import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createTenantsController } from './tenants.controller.js';
import { tenantsApi } from './tenants.endpoints.js';
import { createTenantsRepository } from './tenants.repository.js';
import { createTenantsService } from './tenants.service.js';
import type { TenantsRouterDepsType } from './tenants.types.js';

/** The tenants module's composition root; its router is built from `tenantsApi` and mounted at its prefix. */
export function createTenantsRouter({ db, auth, links, emailSender }: TenantsRouterDepsType): Router {
  const service = createTenantsService({
    db,
    repo: createTenantsRepository(),
    emailSender,
    settings: {
      appBaseUrl: links.appBaseUrl,
      verificationTokenTtlSeconds: links.invitationTtlSeconds,
    },
  });
  const controller = createTenantsController({ service });

  return buildRouter(tenantsApi, controller, { db, jwtSecret: auth.jwtSecret });
}
