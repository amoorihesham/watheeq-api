import cookieParser from "cookie-parser";
import express from "express";
import type pg from "pg";
import type { Config } from "./config/config.js";
import { createDb } from "./db/pool.js";
import { createSmtpSender, type EmailSenderType, smtpSettingsOf } from "./email/index.js";
import type { Logger } from "./logging/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { jsonBody } from "./middleware/json-body.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createAuthRouter } from "./modules/auth/index.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createPlansRouter, createTenantsRouter } from "./modules/platform/index.js";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  config: Config;
  /** Defaults to the SMTP sender built from configuration; tests pass a fake that records emails. */
  emailSender?: EmailSenderType;
  /** Extra routers mounted after the body parser. Used by tests to exercise error paths. */
  routers?: { prefix: string; router: express.Router }[];
}

/** Builds the shared middleware and mounts each module's router; every module composes its own layers (T14). */
export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(deps.logger));
  // /health is mounted before body parsing and any future authentication.
  app.use(createHealthRouter(deps.pool));
  app.use(jsonBody());
  app.use(cookieParser());

  const db = createDb(deps.pool);
  const { config } = deps;
  const emailSender = deps.emailSender ?? createSmtpSender(smtpSettingsOf(config));
  app.use("/auth", createAuthRouter({ db, config }));
  app.use("/operator/plans", createPlansRouter({ db, config }));
  app.use("/operator/tenants", createTenantsRouter({ db, config, emailSender }));

  for (const { prefix, router } of deps.routers ?? []) {
    app.use(prefix, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
