import cookieParser from "cookie-parser";
import express from "express";
import type pg from "pg";
import type { Config } from "./config/config.js";
import { createDb } from "./db/pool.js";
import { createSmtpSender, type EmailSenderType } from "./email/index.js";
import { setContractChecks } from "./http/checks.js";
import type { Logger } from "./logging/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { jsonBody } from "./middleware/json-body.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";
import { authApi } from "./modules/auth/auth.endpoints.js";
import { createAuthRouter } from "./modules/auth/index.js";
import { createCalendarRouter } from "./modules/calendar/index.js";
import { createEscalationRouter } from "./modules/escalation/index.js";
import { filesApi } from "./modules/files/files.endpoints.js";
import { createFilesRouter } from "./modules/files/index.js";
import { healthApi } from "./modules/health/health.endpoints.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createNotificationsRouter } from "./modules/notifications/index.js";
import { notificationsApi } from "./modules/notifications/notifications.endpoints.js";
import { createOrgRouter } from "./modules/org/index.js";
import { createPlansRouter, createTenantsRouter } from "./modules/platform/index.js";
import { createPositionsRouter } from "./modules/positions/index.js";
import { createPrioritiesRouter } from "./modules/priorities/index.js";
import { createRequestsRouter } from "./modules/requests/index.js";
import { requestsApi } from "./modules/requests/requests.endpoints.js";
import { createPermissionsRouter, createRolesRouter } from "./modules/roles/index.js";
import { createServicesRouter } from "./modules/services/index.js";
import { createSubscriptionsRouter } from "./modules/subscriptions/index.js";
import { createUsersRouter } from "./modules/users/index.js";
import { createWorkflowsRouter } from "./modules/workflows/index.js";
import { createS3Store, type FileStoreType } from "./storage/index.js";

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
  setContractChecks(deps.config.server.env !== "production");
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(deps.logger));
  // /health is mounted before body parsing and any future authentication.
  app.use(healthApi.prefix, createHealthRouter(deps.pool, deps.config.database));
  app.use(cookieParser());

  const db = createDb(deps.pool);
  const { config } = deps;
  const { auth, links } = config;
  const emailSender = deps.emailSender ?? createSmtpSender(config.email);
  const store = deps.fileStore ?? createS3Store(config.storage);
  // /files carries raw bytes, so it is mounted before the JSON-only body rule.
  app.use(filesApi.prefix, createFilesRouter({ db, auth, store }));
  app.use(jsonBody());
  app.use(authApi.prefix, createAuthRouter({ db, auth, links, emailSender }));
  app.use("/operator/plans", createPlansRouter({ db, auth }));
  app.use("/operator/tenants", createTenantsRouter({ db, auth, links, emailSender }));
  app.use("/subscription", createSubscriptionsRouter({ db, auth }));
  app.use("/org-units", createOrgRouter({ db, auth }));
  app.use("/users", createUsersRouter({ db, auth, links, emailSender }));
  app.use("/roles", createRolesRouter({ db, auth }));
  app.use("/permissions", createPermissionsRouter({ db, auth }));
  app.use("/calendar", createCalendarRouter({ db, auth }));
  app.use("/positions", createPositionsRouter({ db, auth }));
  app.use("/workflows", createWorkflowsRouter({ db, auth }));
  app.use("/services", createServicesRouter({ db, auth }));
  app.use("/priorities", createPrioritiesRouter({ db, auth }));
  app.use("/escalation", createEscalationRouter({ db, auth }));
  app.use(requestsApi.prefix, createRequestsRouter({ db, auth, store }));
  app.use(notificationsApi.prefix, createNotificationsRouter({ db, auth }));

  for (const { prefix, router } of deps.routers ?? []) {
    app.use(prefix, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
