import type express from "express";
import { AppError } from "@/http/errors.js";
import { sendData } from "@/http/respond.js";
import { healthResponseSchema } from "./health.responses.js";
import type { HealthRepositoryType } from "./health.types.js";

/** No service layer: there is no business rule between the request and the database ping. */
export function createHealthController({ repo }: { repo: HealthRepositoryType }) {
  return {
    health: (async (_req, res) => {
      if (!(await repo.isDbUp())) {
        throw new AppError("SERVICE_UNAVAILABLE");
      }
      sendData(res, 200, healthResponseSchema, { status: "ok", db: "up" });
    }) satisfies express.RequestHandler,
  };
}
