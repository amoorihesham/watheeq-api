import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createEscalationController } from "./escalation.controller.js";
import { createEscalationRepository } from "./escalation.repository.js";
import { createEscalationService } from "./escalation.service.js";
import type { EscalationRouterDepsType } from "./escalation.types.js";

/** Mounted at `/escalation`; the module's composition root. */
export function createEscalationRouter({ db, auth }: EscalationRouterDepsType): Router {
  const controller = createEscalationController({
    service: createEscalationService({ db, repo: createEscalationRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(auth.jwtSecret), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("escalation.view"), controller.get);
  router.put("/", requireTenantPermission("escalation.manage"), controller.put);
  return router;
}
