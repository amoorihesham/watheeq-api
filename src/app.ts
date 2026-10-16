import express from "express";
import type pg from "pg";
import { healthRouter } from "./health/health.routes.js";
import { errorHandler } from "./http/error-handler.js";
import { jsonBody, notFoundHandler } from "./http/middleware.js";
import { httpLogger } from "./logging/http-logger.js";
import type { Logger } from "./logging/logger.js";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  /** Extra routers mounted after the body parser. Used by tests to exercise error paths. */
  routers?: express.Router[];
}

export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(httpLogger(deps.logger));
  // /health is mounted before body parsing and any future authentication.
  app.use(healthRouter(deps.pool));
  app.use(jsonBody());
  for (const router of deps.routers ?? []) {
    app.use(router);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
