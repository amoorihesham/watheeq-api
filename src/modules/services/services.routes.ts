import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createServicesController } from "./services.controller.js";
import { createServicesRepository } from "./services.repository.js";
import { createServicesService } from "./services.service.js";
import type { ServicesRouterDepsType } from "./services.types.js";

/** Mounted at `/services`; the module's composition root. */
export function createServicesRouter({ db, auth }: ServicesRouterDepsType): Router {
  const controller = createServicesController({
    service: createServicesService({ db, repo: createServicesRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(auth.jwtSecret), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("service.view"), controller.list);
  router.get("/:serviceId", requireTenantPermission("service.view"), controller.get);
  router.post("/", requireTenantPermission("service.manage"), controller.create);
  router.patch("/:serviceId", requireTenantPermission("service.manage"), controller.update);
  router.put("/:serviceId/form", requireTenantPermission("service.manage"), controller.updateForm);
  router.post("/:serviceId/retire", requireTenantPermission("service.manage"), controller.retire);
  router.post("/:serviceId/restore", requireTenantPermission("service.manage"), controller.restore);
  return router;
}
