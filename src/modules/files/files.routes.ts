import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createFilesController } from './files.controller.js';
import { filesApi } from './files.endpoints.js';
import { createFilesRepository } from './files.repository.js';
import { createFilesService } from './files.service.js';
import type { FilesRouterDepsType } from './files.types.js';

/** The module's composition root: the `/files` router, mounted before the JSON body rule because `POST /files` takes raw bytes. */
export function createFilesRouter({ db, auth, store }: FilesRouterDepsType): Router {
  const controller = createFilesController({
    service: createFilesService({ db, repo: createFilesRepository(), store }),
  });
  return buildRouter(filesApi, controller, { db, jwtSecret: auth.jwtSecret });
}
