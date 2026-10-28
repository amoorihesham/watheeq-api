import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createNotificationsController } from './notifications.controller.js';
import { notificationsApi } from './notifications.endpoints.js';
import { createNotificationsRepository } from './notifications.repository.js';
import { createNotificationsService } from './notifications.service.js';
import type { NotificationsRouterDepsType } from './notifications.types.js';

/** The module's composition root: the `/notifications` router built from its declarations. */
export function createNotificationsRouter({ db, auth }: NotificationsRouterDepsType): Router {
  const controller = createNotificationsController({
    service: createNotificationsService({ db, repo: createNotificationsRepository() }),
  });
  return buildRouter(notificationsApi, controller, { db, jwtSecret: auth.jwtSecret });
}
