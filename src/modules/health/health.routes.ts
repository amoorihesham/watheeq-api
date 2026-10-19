import { Router } from "express";
import type pg from "pg";
import { HEALTH_TIMEOUT_MS } from "../../db/pool.js";

async function isDbUp(pool: pg.Pool): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), HEALTH_TIMEOUT_MS);
  });
  try {
    await Promise.race([pool.query("SELECT 1"), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(pool: pg.Pool): Router {
  const router = Router();
  router.get("/health", async (_req, res) => {
    if (await isDbUp(pool)) {
      res.status(200).json({ status: "ok", db: "up" });
    } else {
      res.status(503).json({ status: "error", db: "down" });
    }
  });
  return router;
}
