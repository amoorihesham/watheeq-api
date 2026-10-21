import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
// The file, not auth's index: auth imports this module for `/auth/me`, and the index would close a cycle.
import { authenticate, requireRole } from "@/modules/auth/shared/middlewares.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { subscriptionGuard } from "./shared/middlewares.js";
import { createSubscriptionsController } from "./subscriptions.controller.js";
import { createSubscriptionsRepository } from "./subscriptions.repository.js";
import { createSubscriptionsService } from "./subscriptions.service.js";
import type { SubscriptionsRouterDepsType } from "./subscriptions.types.js";

/** The subscriptions module's composition root; mounted at `/subscription`. */
export function createSubscriptionsRouter({ db, config }: SubscriptionsRouterDepsType): Router {
  const service = createSubscriptionsService({ db, repo: createSubscriptionsRepository() });
  const controller = createSubscriptionsController({ service });

  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("subscription.view"), controller.get);
  return router;
}
