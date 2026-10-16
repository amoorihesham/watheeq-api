import express from "express";
import type pg from "pg";
import { healthRouter } from "./health/health.routes.js";

export interface AppDeps {
  pool: pg.Pool;
}

export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(healthRouter(deps.pool));
  return app;
}
