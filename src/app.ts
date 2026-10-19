import express from "express";
import type pg from "pg";
import type { Config } from "./config/config.js";
import { createDb } from "./db/pool.js";
import type { Logger } from "./logging/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { jsonBody } from "./middleware/json-body.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createRequireOperator } from "./middleware/require-operator.js";
import { createRequireUser } from "./middleware/require-user.js";
import { createOperatorRepository } from "./modules/auth/operator/operator.repository.js";
import { createOperatorAuthController } from "./modules/auth/operator/operator-auth.controller.js";
import { operatorAuthRouter } from "./modules/auth/operator/operator-auth.routes.js";
import { createOperatorAuthService } from "./modules/auth/operator/operator-auth.service.js";
import { tenantAuthRouter } from "./modules/auth/tenant/tenant-auth.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";

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
  app.use(requestLogger(deps.logger));
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
  const tenantLifetimes = {
    idleTimeoutSeconds: deps.config.TENANT_SESSION_IDLE_SECONDS,
    absoluteLifetimeSeconds: deps.config.TENANT_SESSION_ABSOLUTE_SECONDS,
  };
  const operatorAuthService = createOperatorAuthService({
    db,
    repo: createOperatorRepository(),
    lifetimes: {
      idleTimeoutSeconds: deps.config.OPERATOR_SESSION_IDLE_SECONDS,
      absoluteLifetimeSeconds: deps.config.OPERATOR_SESSION_ABSOLUTE_SECONDS,
    },
    throttle,
  });
  const requireOperator = createRequireOperator(operatorAuthService);
  const requireUser = createRequireUser(db, tenantLifetimes);
  app.use(
    operatorAuthRouter(
      createOperatorAuthController({ service: operatorAuthService }),
      requireOperator,
    ),
  );
  app.use(tenantAuthRouter(db, tenantLifetimes, throttle, requireUser));
  for (const router of deps.routers ?? []) {
    app.use(router);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
