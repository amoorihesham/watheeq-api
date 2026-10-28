import cookieParser from 'cookie-parser';
import type pg from 'pg';
import cors from 'cors';
import express, { type Express } from 'express';
import { createDb } from './db/pool.js';

import { createSmtpSender, type EmailSenderType } from './email/index.js';
import { apis } from './http/apis.js';
import { setContractChecks } from './http/checks.js';
import { createDocsRouter } from './http/docs.js';
import { buildOpenApi } from './http/openapi.js';
import type { Logger } from './logging/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { jsonBody } from './middleware/json-body.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestLogger } from './middleware/request-logger.js';
import { authApi } from './modules/auth/auth.endpoints.js';
import { createAuthRouter } from './modules/auth/index.js';
import { calendarApi } from './modules/calendar/calendar.endpoints.js';
import { createCalendarRouter } from './modules/calendar/index.js';
import { escalationApi } from './modules/escalation/escalation.endpoints.js';
import { createEscalationRouter } from './modules/escalation/index.js';
import { filesApi } from './modules/files/files.endpoints.js';
import { createFilesRouter } from './modules/files/index.js';
import { healthApi } from './modules/health/health.endpoints.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createNotificationsRouter } from './modules/notifications/index.js';
import { notificationsApi } from './modules/notifications/notifications.endpoints.js';
import { createOrgRouter } from './modules/org/index.js';
import { orgApi } from './modules/org/org.endpoints.js';
import { createPlansRouter, createTenantsRouter } from './modules/platform/index.js';
import { plansApi } from './modules/platform/plans/plans.endpoints.js';
import { tenantsApi } from './modules/platform/tenants/tenants.endpoints.js';
import { createPositionsRouter } from './modules/positions/index.js';
import { positionsApi } from './modules/positions/positions.endpoints.js';
import { createPrioritiesRouter } from './modules/priorities/index.js';
import { prioritiesApi } from './modules/priorities/priorities.endpoints.js';
import { createRequestsRouter } from './modules/requests/index.js';
import { requestsApi } from './modules/requests/requests.endpoints.js';
import { createPermissionsRouter, createRolesRouter } from './modules/roles/index.js';
import { permissionsApi, rolesApi } from './modules/roles/roles.endpoints.js';
import { createServicesRouter } from './modules/services/index.js';
import { servicesApi } from './modules/services/services.endpoints.js';
import { createSubscriptionsRouter } from './modules/subscriptions/index.js';
import { subscriptionsApi } from './modules/subscriptions/subscriptions.endpoints.js';
import { createUsersRouter } from './modules/users/index.js';
import { usersApi } from './modules/users/users.endpoints.js';
import { createWorkflowsRouter } from './modules/workflows/index.js';
import { workflowsApi } from './modules/workflows/workflows.endpoints.js';
import { createS3Store, type FileStoreType } from './storage/index.js';
import type { Config } from './config/config.js';

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  config: Config;
  emailSender?: EmailSenderType;
  fileStore?: FileStoreType;
}

export function buildApp(deps: AppDeps): Express {
  setContractChecks(deps.config.server.env !== 'production');

  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(deps.logger));
  app.use(
    cors({
      credentials: true,
      origin: deps.config.frontend.appUrl,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS', 'DELETE'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  // /health is mounted before body parsing and any future authentication.
  app.use(healthApi.prefix, createHealthRouter(deps.pool, deps.config.database));
  app.use(cookieParser());

  const db = createDb(deps.pool);
  const emailSender = deps.emailSender ?? createSmtpSender(deps.config.smtp);
  const store = deps.fileStore ?? createS3Store(deps.config.storage);
  // /files carries raw bytes, so it is mounted before the JSON-only body rule.
  app.use(filesApi.prefix, createFilesRouter({ db, auth: deps.config.auth, store }));
  app.use(jsonBody());
  app.use(
    authApi.prefix,
    createAuthRouter({
      db,
      auth: deps.config.auth,
      links: deps.config.frontend,
      emailSender,
    }),
  );
  app.use(plansApi.prefix, createPlansRouter({ db, auth: deps.config.auth }));
  app.use(
    tenantsApi.prefix,
    createTenantsRouter({
      db,
      auth: deps.config.auth,
      links: deps.config.frontend,
      emailSender,
    }),
  );
  app.use(subscriptionsApi.prefix, createSubscriptionsRouter({ db, auth: deps.config.auth }));
  app.use(orgApi.prefix, createOrgRouter({ db, auth: deps.config.auth }));
  app.use(
    usersApi.prefix,
    createUsersRouter({
      db,
      auth: deps.config.auth,
      links: deps.config.frontend,
      emailSender,
    }),
  );
  app.use(rolesApi.prefix, createRolesRouter({ db, auth: deps.config.auth }));
  app.use(permissionsApi.prefix, createPermissionsRouter({ db, auth: deps.config.auth }));
  app.use(calendarApi.prefix, createCalendarRouter({ db, auth: deps.config.auth }));
  app.use(positionsApi.prefix, createPositionsRouter({ db, auth: deps.config.auth }));
  app.use(workflowsApi.prefix, createWorkflowsRouter({ db, auth: deps.config.auth }));
  app.use(servicesApi.prefix, createServicesRouter({ db, auth: deps.config.auth }));
  app.use(prioritiesApi.prefix, createPrioritiesRouter({ db, auth: deps.config.auth }));
  app.use(escalationApi.prefix, createEscalationRouter({ db, auth: deps.config.auth }));
  app.use(requestsApi.prefix, createRequestsRouter({ db, auth: deps.config.auth, store }));
  app.use(notificationsApi.prefix, createNotificationsRouter({ db, auth: deps.config.auth }));

  if (deps.config.server.env !== 'production') {
    app.use(createDocsRouter(buildOpenApi(apis)));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
