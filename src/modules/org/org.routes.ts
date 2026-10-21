import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createOrgController } from "./org.controller.js";
import { createOrgRepository } from "./org.repository.js";
import { createOrgService } from "./org.service.js";
import type { OrgRouterDepsType } from "./org.types.js";

/** The org module's composition root; mounted at `/org-units`. */
export function createOrgRouter({ db, config }: OrgRouterDepsType): Router {
  const service = createOrgService({ db, repo: createOrgRepository() });
  const controller = createOrgController({ service });

  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("org.view"), controller.tree);
  router.post("/", requireTenantPermission("org.manage"), controller.create);
  router.patch("/:unitId", requireTenantPermission("org.manage"), controller.update);
  router.delete("/:unitId", requireTenantPermission("org.manage"), controller.delete);
  return router;
}
