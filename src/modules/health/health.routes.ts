import { Router } from "express";
import type pg from "pg";
import type { DatabaseConfigType } from "@/config/config.js";
import { createHealthController } from "./health.controller.js";
import { createHealthRepository } from "./health.repository.js";

/** The health module's composition root. Takes the pool and the database group, because the ping needs its own deadline. */
export function createHealthRouter(pool: pg.Pool, { timeoutMs }: DatabaseConfigType): Router {
  const controller = createHealthController({ repo: createHealthRepository(pool, timeoutMs) });
  const router = Router();
  router.get("/health", controller.health);
  return router;
}
