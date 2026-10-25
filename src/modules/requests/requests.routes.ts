import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { requireActiveSubscription, subscriptionGuard } from "@/modules/subscriptions/index.js";
import { requireTenantPermission } from "@/modules/tenant-access/index.js";
import { createRequestsController } from "./requests.controller.js";
import { createRequestsRepository } from "./requests.repository.js";
import { createRequestsService } from "./requests.service.js";
import type { RequestsRouterDepsType } from "./requests.types.js";

/**
 * Mounted at `/requests`; the module's composition root. Routes for parties (the requester, the handler, the
 * stage assignees) and the reads declare no permission: being the party, or seeing the request under R6.7, is the
 * authorization, checked in the database for each request (D31, a recorded exception to T24).
 */
export function createRequestsRouter({ db, config, store }: RequestsRouterDepsType): Router {
  const controller = createRequestsController({
    service: createRequestsService({ db, repo: createRequestsRepository(), store }),
  });
  const router = Router();
  router.use(noStore, authenticate(config.JWT_SECRET), requireRole("user"), subscriptionGuard(db));
  router.get("/catalog", requireTenantPermission("request.submit"), controller.catalog);
  router.post(
    "/",
    requireTenantPermission("request.submit"),
    requireActiveSubscription(),
    controller.submit,
  );
  router.get("/", controller.list);
  router.get("/:requestId", controller.get);
  router.put(
    "/:requestId/priority",
    requireTenantPermission("request.review"),
    controller.changePriority,
  );
  router.post("/:requestId/accept", requireTenantPermission("request.review"), controller.accept);
  router.post("/:requestId/reject", requireTenantPermission("request.review"), controller.reject);
  router.post("/:requestId/withdraw", controller.withdraw);
  router.put(
    "/:requestId/handler",
    requireTenantPermission("request.reassign"),
    controller.changeHandler,
  );
  const stage = (action: string) => `/:requestId/stages/:runId/${action}`;
  router.post(stage("complete"), controller.stageAction("completeStage"));
  router.post(stage("return"), controller.stageAction("returnStage"));
  router.post(stage("narrow"), controller.stageAction("narrowStage"));
  router.post(stage("escalate"), controller.stageAction("escalateStage"));
  router.post(stage("refresh"), controller.stageAction("refreshStage"));
  router.post("/:requestId/files", controller.attachFiles);
  router.post("/:requestId/files/:fileId/remove", controller.removeFile);
  router.get("/:requestId/files/:fileId/content", controller.fileContent);
  return router;
}
