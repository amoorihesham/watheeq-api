import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createPlansController } from './plans.controller.js';
import { plansApi } from './plans.endpoints.js';
import { createPlansRepository } from './plans.repository.js';
import { createPlansService } from './plans.service.js';
import type { PlansRouterDepsType } from './plans.types.js';

/** The plans module's composition root; its router is built from `plansApi` and mounted at its prefix. */
export function createPlansRouter({ db, auth }: PlansRouterDepsType): Router {
  const service = createPlansService({ db, repo: createPlansRepository() });
  const controller = createPlansController({ service });

  return buildRouter(plansApi, controller, { db, jwtSecret: auth.jwt });
}
