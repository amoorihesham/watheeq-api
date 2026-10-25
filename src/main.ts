import { buildApp } from "./app.js";
import { parseConfig } from "./config/config.js";
import { createDb, createPool } from "./db/pool.js";
import { createLogger } from "./logging/logger.js";
import { startFileSweeps } from "./modules/files/index.js";
import { createS3Store, storageSettingsOf } from "./storage/index.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  createLogger("info").fatal(parsed.message);
  process.exit(1);
}

const config = parsed.config;
const logger = createLogger(config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, logger);
const fileStore = createS3Store(storageSettingsOf(config));
let fileSweeps: ReturnType<typeof startFileSweeps> | undefined;
const server = buildApp({ pool, logger, config, fileStore }).listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "listening");
  fileSweeps = startFileSweeps({ db: createDb(pool), store: fileStore, logger });
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Clears the sweep timer now; a batch in progress finishes or rolls back before the pool closes.
  const sweepsStopped = Promise.resolve(fileSweeps?.stop());

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
    sweepsStopped
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
