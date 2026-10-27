import { buildApp } from "./app.js";
import { parseConfig } from "./config/config.js";
import { createDb, createPool } from "./db/pool.js";
import { buildJobs } from "./jobs.js";
import { createLogger } from "./logging/logger.js";
import { type SchedulerType, selectJobs, startScheduler } from "./scheduler/index.js";
import { createS3Store } from "./storage/index.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  createLogger("info").fatal(parsed.message);
  process.exit(1);
}

const config = parsed.config;
const logger = createLogger(config.server.logLevel);

const fileStore = createS3Store(config.storage);

// Names in JOBS are checked here, before anything listens, because config does not know the job names.
let jobs: ReturnType<typeof selectJobs>;
try {
  jobs = selectJobs(config.jobs.enabled, buildJobs({ fileStore }));
} catch (err) {
  logger.fatal({ err }, "invalid JOBS setting");
  process.exit(1);
}

const pool = createPool(config.database, logger);
let scheduler: SchedulerType | undefined;
const server = buildApp({ pool, logger, config, fileStore }).listen(config.server.port, () => {
  logger.info({ port: config.server.port, env: config.server.env }, "listening");
  scheduler = startScheduler({ jobs, db: createDb(pool), logger });
  logger.info({ jobs: jobs.map((job) => job.name) }, "scheduler started");
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Clears the job timers now; a job stops between transactions, and the one in progress finishes or rolls back
  // before the pool closes.
  const jobsStopped = Promise.resolve(scheduler?.stop());

  let exitCode = 0;
  const forceTimer = setTimeout(() => {
    logger.error(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      "in-flight requests did not finish, closing connections",
    );
    exitCode = 1;
    server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  server.close(() => {
    clearTimeout(forceTimer);
    jobsStopped
      .then(() => pool.end())
      .catch((err: unknown) => {
        logger.error({ err }, "error closing database pool");
        exitCode = 1;
      })
      .finally(() => process.exit(exitCode));
  });
  server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  process.exit(1);
});
