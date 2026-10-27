import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createRolesController } from "./roles.controller.js";
import { createRolesRepository } from "./roles.repository.js";
import { createRolesService } from "./roles.service.js";
import type { RolesRouterDepsType } from "./roles.types.js";

/** The roles module's composition root, shared by its two routers. */
function composeController({ db }: RolesRouterDepsType) {
  return createRolesController({
    service: createRolesService({ db, repo: createRolesRepository() }),
  });
}

function tenantRouter({ db, auth }: RolesRouterDepsType): Router {
  const router = Router();
  router.use(noStore, authenticate(auth.jwtSecret), requireRole("user"), subscriptionGuard(db));
  return router;
}

/** Mounted at `/roles`. */
export function createRolesRouter(deps: RolesRouterDepsType): Router {
  const controller = composeController(deps);
  const router = tenantRouter(deps);
  router.get("/", requireTenantPermission("role.view"), controller.list);
  router.get("/:roleId", requireTenantPermission("role.view"), controller.get);
  router.post("/", requireTenantPermission("role.manage"), controller.create);
  router.patch("/:roleId", requireTenantPermission("role.manage"), controller.update);
  router.delete("/:roleId", requireTenantPermission("role.manage"), controller.delete);
  return router;
}

/** Mounted at `/permissions`: the catalog roles are built from (R3.1). */
export function createPermissionsRouter(deps: RolesRouterDepsType): Router {
  const controller = composeController(deps);
  const router = tenantRouter(deps);
  router.get("/", requireTenantPermission("role.view"), controller.permissions);
  return router;
}
