import type { Router } from "express";
import { buildRouter } from "@/http/endpoint.js";
import { createEscalationController } from "./escalation.controller.js";
import { escalationApi } from "./escalation.endpoints.js";
import { createEscalationRepository } from "./escalation.repository.js";
import { createEscalationService } from "./escalation.service.js";
import type { EscalationRouterDepsType } from "./escalation.types.js";

/** The module's composition root; its router is built from `escalationApi` and mounted at its prefix. */
export function createEscalationRouter({ db, auth }: EscalationRouterDepsType): Router {
  const controller = createEscalationController({
    service: createEscalationService({ db, repo: createEscalationRepository() }),
  });
  return buildRouter(escalationApi, controller, { db, jwtSecret: auth.jwtSecret });
}
