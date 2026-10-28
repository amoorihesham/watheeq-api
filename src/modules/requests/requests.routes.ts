import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createRequestsController } from './requests.controller.js';
import { requestsApi } from './requests.endpoints.js';
import { createRequestsRepository } from './requests.repository.js';
import { createRequestsService } from './requests.service.js';
import type { RequestsRouterDepsType } from './requests.types.js';

/** The module's composition root: the `/requests` router built from its declarations. */
export function createRequestsRouter({ db, auth, store }: RequestsRouterDepsType): Router {
  const controller = createRequestsController({
    service: createRequestsService({ db, repo: createRequestsRepository(), store }),
  });
  return buildRouter(requestsApi, controller, { db, jwtSecret: auth.jwt });
}
