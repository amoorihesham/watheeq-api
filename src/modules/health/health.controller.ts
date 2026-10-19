import type express from "express";
import type { HealthRepository } from "./health.repository.js";

/** No service layer: there is no business rule between the request and the database ping. */
export function createHealthController({ repo }: { repo: HealthRepository }) {
  return {
    health: (async (_req, res) => {
      if (await repo.isDbUp()) {
        res.status(200).json({ status: "ok", db: "up" });
      } else {
        res.status(503).json({ status: "error", db: "down" });
      }
    }) satisfies express.RequestHandler,
  };
}

export type HealthController = ReturnType<typeof createHealthController>;
