import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
// The file, not auth's index: auth imports this module for `/auth/me`, and the index would close a cycle.
import { authenticate, requireRole } from "@/modules/auth/shared/middlewares.js";
import { subscriptionGuard } from "./shared/middlewares.js";
import { createSubscriptionsController } from "./subscriptions.controller.js";
import { createSubscriptionsRepository } from "./subscriptions.repository.js";
import { createSubscriptionsService } from "./subscriptions.service.js";
import type { SubscriptionsRouterDepsType } from "./subscriptions.types.js";

/**
 * The subscriptions module's composition root; mounted at `/subscription`. `subscription.view` is declared here
 * and enforced from Phase 3; until then any user of the tenant may read it (Phase 1 spec, 4.2).
 */
export function createSubscriptionsRouter({ db, config }: SubscriptionsRouterDepsType): Router {
  const service = createSubscriptionsService({ db, repo: createSubscriptionsRepository() });
  const controller = createSubscriptionsController({ service });

  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", controller.get);
  return router;
}
