import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createPrioritiesController } from "./priorities.controller.js";
import { createPrioritiesRepository } from "./priorities.repository.js";
import { createPrioritiesService } from "./priorities.service.js";
import type { PrioritiesRouterDepsType } from "./priorities.types.js";

/** Mounted at `/priorities`; the module's composition root. */
export function createPrioritiesRouter({ db, config }: PrioritiesRouterDepsType): Router {
  const controller = createPrioritiesController({
    service: createPrioritiesService({ db, repo: createPrioritiesRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("priority.view"), controller.list);
  router.post("/", requireTenantPermission("priority.manage"), controller.create);
  router.put("/order", requireTenantPermission("priority.manage"), controller.reorder);
  router.patch("/:priorityId", requireTenantPermission("priority.manage"), controller.update);
  router.post("/:priorityId/retire", requireTenantPermission("priority.manage"), controller.retire);
  router.post(
    "/:priorityId/restore",
    requireTenantPermission("priority.manage"),
    controller.restore,
  );
  return router;
}
