import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createOrgController } from './org.controller.js';
import { orgApi } from './org.endpoints.js';
import { createOrgRepository } from './org.repository.js';
import { createOrgService } from './org.service.js';
import type { OrgRouterDepsType } from './org.types.js';

/** The org module's composition root; its router is built from `orgApi` and mounted at its prefix. */
export function createOrgRouter({ db, auth }: OrgRouterDepsType): Router {
  const service = createOrgService({ db, repo: createOrgRepository() });
  const controller = createOrgController({ service });

  return buildRouter(orgApi, controller, { db, jwtSecret: auth.jwtSecret });
}
