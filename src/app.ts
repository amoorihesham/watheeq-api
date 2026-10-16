import express from "express";
import type pg from "pg";
import { operatorAuthRouter } from "./auth/operator/operator-auth.routes.js";
import type { Config } from "./config/config.js";
import { createDb } from "./db/pool.js";
import { healthRouter } from "./health/health.routes.js";
import { errorHandler } from "./http/error-handler.js";
import { jsonBody, notFoundHandler } from "./http/middleware.js";
import { httpLogger } from "./logging/http-logger.js";
import type { Logger } from "./logging/logger.js";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  config: Pick<Config, "OPERATOR_SESSION_IDLE_SECONDS" | "OPERATOR_SESSION_ABSOLUTE_SECONDS">;
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
  app.use(
    operatorAuthRouter(createDb(deps.pool), {
      idleTimeoutSeconds: deps.config.OPERATOR_SESSION_IDLE_SECONDS,
      absoluteLifetimeSeconds: deps.config.OPERATOR_SESSION_ABSOLUTE_SECONDS,
    }),
  );
  for (const router of deps.routers ?? []) {
    app.use(router);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
