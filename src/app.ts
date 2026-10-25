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
import { createCalendarRouter } from "./modules/calendar/index.js";
import { createEscalationRouter } from "./modules/escalation/index.js";
import { createFilesRouter } from "./modules/files/index.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createOrgRouter } from "./modules/org/index.js";
import { createPlansRouter, createTenantsRouter } from "./modules/platform/index.js";
import { createPositionsRouter } from "./modules/positions/index.js";
import { createPrioritiesRouter } from "./modules/priorities/index.js";
import { createRequestsRouter } from "./modules/requests/index.js";
import { createPermissionsRouter, createRolesRouter } from "./modules/roles/index.js";
import { createServicesRouter } from "./modules/services/index.js";
import { createSubscriptionsRouter } from "./modules/subscriptions/index.js";
import { createUsersRouter } from "./modules/users/index.js";
import { createWorkflowsRouter } from "./modules/workflows/index.js";
import { createS3Store, type FileStoreType, storageSettingsOf } from "./storage/index.js";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  config: Config;
  /** Defaults to the SMTP sender built from configuration; tests pass a fake that records emails. */
  emailSender?: EmailSenderType;
  /** Defaults to the S3 store built from configuration; tests pass one connected to their own server. */
  fileStore?: FileStoreType;
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
  app.use(cookieParser());

  const db = createDb(deps.pool);
  const { config } = deps;
  const emailSender = deps.emailSender ?? createSmtpSender(smtpSettingsOf(config));
  const store = deps.fileStore ?? createS3Store(storageSettingsOf(config));
  // /files carries raw bytes, so it is mounted before the JSON-only body rule.
  app.use("/files", createFilesRouter({ db, config, store }));
  app.use(jsonBody());
  app.use("/auth", createAuthRouter({ db, config, emailSender }));
  app.use("/operator/plans", createPlansRouter({ db, config }));
  app.use("/operator/tenants", createTenantsRouter({ db, config, emailSender }));
  app.use("/subscription", createSubscriptionsRouter({ db, config }));
  app.use("/org-units", createOrgRouter({ db, config }));
  app.use("/users", createUsersRouter({ db, config, emailSender }));
  app.use("/roles", createRolesRouter({ db, config }));
  app.use("/permissions", createPermissionsRouter({ db, config }));
  app.use("/calendar", createCalendarRouter({ db, config }));
  app.use("/positions", createPositionsRouter({ db, config }));
  app.use("/workflows", createWorkflowsRouter({ db, config }));
  app.use("/services", createServicesRouter({ db, config }));
  app.use("/priorities", createPrioritiesRouter({ db, config }));
  app.use("/escalation", createEscalationRouter({ db, config }));
  app.use("/requests", createRequestsRouter({ db, config }));

  for (const { prefix, router } of deps.routers ?? []) {
    app.use(prefix, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
