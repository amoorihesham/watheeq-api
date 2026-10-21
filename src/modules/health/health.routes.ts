import { Router } from "express";
import type pg from "pg";
import { createHealthController } from "./health.controller.js";
import { createHealthRepository } from "./health.repository.js";

/** The health module's composition root. Takes the pool, because the ping needs its own deadline. */
export function createHealthRouter(pool: pg.Pool): Router {
  const controller = createHealthController({ repo: createHealthRepository(pool) });
  const router = Router();
  router.get("/health", controller.health);
  return router;
}
