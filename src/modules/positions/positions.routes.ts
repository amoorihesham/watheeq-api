import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createPositionsController } from "./positions.controller.js";
import { createPositionsRepository } from "./positions.repository.js";
import { createPositionsService } from "./positions.service.js";
import type { PositionsRouterDepsType } from "./positions.types.js";

/** Mounted at `/positions`; the module's composition root. */
export function createPositionsRouter({ db, config }: PositionsRouterDepsType): Router {
  const controller = createPositionsController({
    service: createPositionsService({ db, repo: createPositionsRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("position.view"), controller.list);
  router.get("/:positionId", requireTenantPermission("position.view"), controller.get);
  router.post("/", requireTenantPermission("position.manage"), controller.create);
  router.patch("/:positionId", requireTenantPermission("position.manage"), controller.rename);
  router.put(
    "/:positionId/holders",
    requireTenantPermission("position.manage"),
    controller.setHolders,
  );
  router.post("/:positionId/retire", requireTenantPermission("position.manage"), controller.retire);
  router.post(
    "/:positionId/restore",
    requireTenantPermission("position.manage"),
    controller.restore,
  );
  return router;
}
