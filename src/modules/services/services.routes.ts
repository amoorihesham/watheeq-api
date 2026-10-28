import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createServicesController } from './services.controller.js';
import { servicesApi } from './services.endpoints.js';
import { createServicesRepository } from './services.repository.js';
import { createServicesService } from './services.service.js';
import type { ServicesRouterDepsType } from './services.types.js';

/** The module's composition root; its router is built from `servicesApi` and mounted at its prefix. */
export function createServicesRouter({ db, auth }: ServicesRouterDepsType): Router {
  const controller = createServicesController({
    service: createServicesService({ db, repo: createServicesRepository() }),
  });
  return buildRouter(servicesApi, controller, { db, jwtSecret: auth.jwt });
}
