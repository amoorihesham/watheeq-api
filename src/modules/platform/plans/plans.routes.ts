import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { requirePlatformPermission } from "../shared/middlewares.js";
import { createPlansController } from "./plans.controller.js";
import { createPlansRepository } from "./plans.repository.js";
import { createPlansService } from "./plans.service.js";
import type { PlansRouterDepsType } from "./plans.types.js";

/** The plans module's composition root; mounted at `/operator/plans`. */
export function createPlansRouter({ db, auth }: PlansRouterDepsType): Router {
  const service = createPlansService({ db, repo: createPlansRepository() });
  const controller = createPlansController({ service });

  const router = Router();
  router.use(noStore, authenticate(auth.jwtSecret), requireRole("operator"));
  router.post("/", requirePlatformPermission("platform.plan.create"), controller.create);
  router.get("/", requirePlatformPermission("platform.plan.view"), controller.list);
  router.get("/:planId", requirePlatformPermission("platform.plan.view"), controller.get);
  router.patch("/:planId", requirePlatformPermission("platform.plan.update"), controller.update);
  return router;
}
