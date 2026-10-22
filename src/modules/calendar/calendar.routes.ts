import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createCalendarController } from "./calendar.controller.js";
import { createCalendarRepository } from "./calendar.repository.js";
import { createCalendarService } from "./calendar.service.js";
import type { CalendarRouterDepsType } from "./calendar.types.js";

/** Mounted at `/calendar`; the module's composition root. */
export function createCalendarRouter({ db, config }: CalendarRouterDepsType): Router {
  const controller = createCalendarController({
    service: createCalendarService({ db, repo: createCalendarRepository() }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/", requireTenantPermission("calendar.view"), controller.get);
  router.get("/days", requireTenantPermission("calendar.view"), controller.days);
  router.put(
    "/hours/:effectiveFrom",
    requireTenantPermission("calendar.manage"),
    controller.setHours,
  );
  router.delete(
    "/hours/:effectiveFrom",
    requireTenantPermission("calendar.manage"),
    controller.deleteHours,
  );
  router.post("/periods", requireTenantPermission("calendar.manage"), controller.createPeriod);
  router.patch(
    "/periods/:periodId",
    requireTenantPermission("calendar.manage"),
    controller.updatePeriod,
  );
  router.delete(
    "/periods/:periodId",
    requireTenantPermission("calendar.manage"),
    controller.deletePeriod,
  );
  router.put(
    "/periods/:periodId/overrides/:year",
    requireTenantPermission("calendar.manage"),
    controller.setOverride,
  );
  router.delete(
    "/periods/:periodId/overrides/:year",
    requireTenantPermission("calendar.manage"),
    controller.deleteOverride,
  );
  return router;
}
