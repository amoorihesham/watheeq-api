import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { createNotificationsController } from "./notifications.controller.js";
import { createNotificationsRepository } from "./notifications.repository.js";
import { createNotificationsService } from "./notifications.service.js";
import type { NotificationsRouterDepsType } from "./notifications.types.js";

/**
 * Mounted at `/notifications`; the module's composition root. No `subscriptionGuard` and no permission: every
 * user has an inbox, and marking read writes only the caller's own `read_at`, so it works in Read-only. This is
 * the recorded exception to T16 (P7.7).
 */
export function createNotificationsRouter({ db, config }: NotificationsRouterDepsType): Router {
  const controller = createNotificationsController({
    service: createNotificationsService({ db, repo: createNotificationsRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"));
  router.get("/", controller.list);
  router.get("/unread-count", controller.unreadCount);
  router.post("/read-all", controller.markAllRead);
  router.post("/:id/read", controller.markRead);
  return router;
}
