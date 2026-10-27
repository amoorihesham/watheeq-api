import { Router } from "express";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/index.js";
import { subscriptionGuard } from "@/modules/subscriptions/index.js";
import { createFilesController } from "./files.controller.js";
import { createFilesRepository } from "./files.repository.js";
import { createFilesService } from "./files.service.js";
import type { FilesRouterDepsType } from "./files.types.js";

/**
 * Mounted at `/files`, outside the JSON-only body rule: `POST /files` takes raw bytes. Any active member may use it
 * (Q9, a recorded exception to T24), so no tenant permission is declared; every query is limited to the caller's
 * own pending uploads.
 */
export function createFilesRouter({ db, auth, store }: FilesRouterDepsType): Router {
  const controller = createFilesController({
    service: createFilesService({ db, repo: createFilesRepository(), store }),
  });
  const router = Router();
  router.use(noStore, authenticate(auth.jwtSecret), requireRole("user"), subscriptionGuard(db));
  router.post("/", controller.upload);
  router.get("/:fileId", controller.get);
  router.get("/:fileId/content", controller.content);
  router.delete("/:fileId", controller.discard);
  return router;
}
