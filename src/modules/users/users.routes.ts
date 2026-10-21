import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createUsersController } from "./users.controller.js";
import { createUsersRepository } from "./users.repository.js";
import { createUsersService } from "./users.service.js";
import type { UsersRouterDepsType } from "./users.types.js";

/** The users module's composition root; mounted at `/users`. */
export function createUsersRouter({ db, config, emailSender }: UsersRouterDepsType): Router {
  const service = createUsersService({
    db,
    repo: createUsersRepository(),
    emailSender,
    settings: {
      appBaseUrl: config.APP_BASE_URL,
      invitationTtlSeconds: config.VERIFICATION_TOKEN_TTL_SECONDS,
    },
  });
  const controller = createUsersController({ service });

  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("user.view"), controller.list);
  router.post("/", requireTenantPermission("user.create"), controller.invite);
  router.get("/:userId", requireTenantPermission("user.view"), controller.get);
  router.patch("/:userId", requireTenantPermission("user.update"), controller.update);
  router.post(
    "/:userId/deactivate",
    requireTenantPermission("user.deactivate"),
    controller.deactivate,
  );
  router.post(
    "/:userId/reactivate",
    requireTenantPermission("user.deactivate"),
    controller.reactivate,
  );
  router.post(
    "/:userId/resend-invitation",
    requireTenantPermission("user.create"),
    controller.resendInvitation,
  );
  return router;
}
