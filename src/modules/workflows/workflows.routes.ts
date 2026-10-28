import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createWorkflowsController } from './workflows.controller.js';
import { workflowsApi } from './workflows.endpoints.js';
import { createWorkflowsRepository } from './workflows.repository.js';
import { createWorkflowsService } from './workflows.service.js';
import type { WorkflowsRouterDepsType } from './workflows.types.js';

/** The module's composition root; its router is built from `workflowsApi` and mounted at its prefix. */
export function createWorkflowsRouter({ db, auth }: WorkflowsRouterDepsType): Router {
  const controller = createWorkflowsController({
    service: createWorkflowsService({ db, repo: createWorkflowsRepository() }),
  });
  return buildRouter(workflowsApi, controller, { db, jwtSecret: auth.jwt });
}
