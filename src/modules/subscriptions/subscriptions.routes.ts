import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createSubscriptionsController } from './subscriptions.controller.js';
import { subscriptionsApi } from './subscriptions.endpoints.js';
import { createSubscriptionsRepository } from './subscriptions.repository.js';
import { createSubscriptionsService } from './subscriptions.service.js';
import type { SubscriptionsRouterDepsType } from './subscriptions.types.js';

/** The subscriptions module's composition root; its router is built from `subscriptionsApi` and mounted at its prefix. */
export function createSubscriptionsRouter({ db, auth }: SubscriptionsRouterDepsType): Router {
  const service = createSubscriptionsService({ db, repo: createSubscriptionsRepository() });
  const controller = createSubscriptionsController({ service });

  return buildRouter(subscriptionsApi, controller, { db, jwtSecret: auth.jwt });
}
