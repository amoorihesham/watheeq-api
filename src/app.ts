import express from "express";
import type pg from "pg";
import { operatorAuthRouter } from "./auth/operator/operator-auth.routes.js";
import { tenantAuthRouter } from "./auth/tenant/tenant-auth.routes.js";
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
  config: Omit<Config, "NODE_ENV" | "PORT" | "DATABASE_URL" | "LOG_LEVEL">;
  /** Extra routers mounted after the body parser. Used by tests to exercise error paths. */
  routers?: express.Router[];
}

export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Number of trusted proxy hops: req.ip comes only from hops those proxies added (spec 4.3, client IP).
  app.set("trust proxy", deps.config.TRUST_PROXY);
  app.use(httpLogger(deps.logger));
  // /health is mounted before body parsing and any future authentication.
  app.use(healthRouter(deps.pool));
  app.use(jsonBody());
  const db = createDb(deps.pool);
  const throttle = {
    accountMaxFailures: deps.config.LOGIN_ACCOUNT_MAX_FAILURES,
    accountLockSeconds: deps.config.LOGIN_ACCOUNT_LOCK_SECONDS,
    ipMaxFailures: deps.config.LOGIN_IP_MAX_FAILURES,
    ipWindowSeconds: deps.config.LOGIN_IP_WINDOW_SECONDS,
  };
  app.use(
    operatorAuthRouter(
      db,
      {
        idleTimeoutSeconds: deps.config.OPERATOR_SESSION_IDLE_SECONDS,
        absoluteLifetimeSeconds: deps.config.OPERATOR_SESSION_ABSOLUTE_SECONDS,
      },
      throttle,
    ),
  );
  app.use(
    tenantAuthRouter(
      db,
      {
        idleTimeoutSeconds: deps.config.TENANT_SESSION_IDLE_SECONDS,
        absoluteLifetimeSeconds: deps.config.TENANT_SESSION_ABSOLUTE_SECONDS,
      },
      throttle,
    ),
  );
  for (const router of deps.routers ?? []) {
    app.use(router);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
