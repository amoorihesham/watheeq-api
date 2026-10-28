import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createPositionsController } from './positions.controller.js';
import { positionsApi } from './positions.endpoints.js';
import { createPositionsRepository } from './positions.repository.js';
import { createPositionsService } from './positions.service.js';
import type { PositionsRouterDepsType } from './positions.types.js';

/** The module's composition root; its router is built from `positionsApi` and mounted at its prefix. */
export function createPositionsRouter({ db, auth }: PositionsRouterDepsType): Router {
  const controller = createPositionsController({
    service: createPositionsService({ db, repo: createPositionsRepository() }),
  });
  return buildRouter(positionsApi, controller, { db, jwtSecret: auth.jwtSecret });
}
