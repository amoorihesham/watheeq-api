import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { requirePlatformPermission } from "../shared/middlewares.js";
import { createTenantsController } from "./tenants.controller.js";
import { createTenantsRepository } from "./tenants.repository.js";
import { createTenantsService } from "./tenants.service.js";
import type { TenantsRouterDepsType } from "./tenants.types.js";

/** The tenants module's composition root; mounted at `/operator/tenants`. */
export function createTenantsRouter({ db, config, emailSender }: TenantsRouterDepsType): Router {
  const service = createTenantsService({
    db,
    repo: createTenantsRepository(),
    emailSender,
    settings: {
      appBaseUrl: config.APP_BASE_URL,
      verificationTokenTtlSeconds: config.VERIFICATION_TOKEN_TTL_SECONDS,
    },
  });
  const controller = createTenantsController({ service });

  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("operator"));
  router.post("/", requirePlatformPermission("platform.tenant.create"), controller.create);
  router.get("/", requirePlatformPermission("platform.tenant.view"), controller.list);
  router.get("/:tenantId", requirePlatformPermission("platform.tenant.view"), controller.get);
  router.put(
    "/:tenantId/subscription",
    requirePlatformPermission("platform.subscription.update"),
    controller.changeSubscription,
  );
  router.post(
    "/:tenantId/admin/resend-verification",
    requirePlatformPermission("platform.tenant.create"),
    controller.resendVerification,
  );
  return router;
}
