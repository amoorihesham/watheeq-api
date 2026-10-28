import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createRolesController } from './roles.controller.js';
import { permissionsApi, rolesApi } from './roles.endpoints.js';
import { createRolesRepository } from './roles.repository.js';
import { createRolesService } from './roles.service.js';
import type { RolesRouterDepsType } from './roles.types.js';

/** The roles module's composition root, shared by its two routers. */
function composeController({ db }: RolesRouterDepsType) {
  return createRolesController({
    service: createRolesService({ db, repo: createRolesRepository() }),
  });
}

/** Mounted at `/roles`. */
export function createRolesRouter(deps: RolesRouterDepsType): Router {
  return buildRouter(rolesApi, composeController(deps).roles, {
    db: deps.db,
    jwtSecret: deps.auth.jwt,
  });
}

/** Mounted at `/permissions`: the catalog roles are built from (R3.1). */
export function createPermissionsRouter(deps: RolesRouterDepsType): Router {
  return buildRouter(permissionsApi, composeController(deps).permissions, {
    db: deps.db,
    jwtSecret: deps.auth.jwt,
  });
}
