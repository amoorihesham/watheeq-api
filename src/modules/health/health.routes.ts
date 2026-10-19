import { Router } from "express";
import type { HealthController } from "./health.controller.js";

export function healthRouter(controller: HealthController): Router {
  const router = Router();
  router.get("/health", controller.health);
  return router;
}
