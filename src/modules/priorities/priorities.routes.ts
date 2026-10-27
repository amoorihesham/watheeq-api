import type { Router } from "express";
import { buildRouter } from "@/http/endpoint.js";
import { createPrioritiesController } from "./priorities.controller.js";
import { prioritiesApi } from "./priorities.endpoints.js";
import { createPrioritiesRepository } from "./priorities.repository.js";
import { createPrioritiesService } from "./priorities.service.js";
import type { PrioritiesRouterDepsType } from "./priorities.types.js";

/** The module's composition root; its router is built from `prioritiesApi` and mounted at its prefix. */
export function createPrioritiesRouter({ db, auth }: PrioritiesRouterDepsType): Router {
  const controller = createPrioritiesController({
    service: createPrioritiesService({ db, repo: createPrioritiesRepository() }),
  });
  return buildRouter(prioritiesApi, controller, { db, jwtSecret: auth.jwtSecret });
}
