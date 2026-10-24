import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createWorkflowsController } from "./workflows.controller.js";
import { createWorkflowsRepository } from "./workflows.repository.js";
import { createWorkflowsService } from "./workflows.service.js";
import type { WorkflowsRouterDepsType } from "./workflows.types.js";

/** Mounted at `/workflows`; the module's composition root. */
export function createWorkflowsRouter({ db, config }: WorkflowsRouterDepsType): Router {
  const controller = createWorkflowsController({
    service: createWorkflowsService({ db, repo: createWorkflowsRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("workflow.view"), controller.list);
  router.get("/:workflowId", requireTenantPermission("workflow.view"), controller.get);
  router.get(
    "/:workflowId/versions/:number",
    requireTenantPermission("workflow.view"),
    controller.getVersion,
  );
  router.post("/", requireTenantPermission("workflow.manage"), controller.create);
  router.put("/:workflowId", requireTenantPermission("workflow.manage"), controller.update);
  router.post("/:workflowId/retire", requireTenantPermission("workflow.manage"), controller.retire);
  router.post(
    "/:workflowId/restore",
    requireTenantPermission("workflow.manage"),
    controller.restore,
  );
  return router;
}
