import { buildApp } from "./app.js";
import { parseConfig } from "./config/config.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./logging/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  // The configured log level is unknown here, so use the default level.
  createLogger("info").fatal(parsed.message);
  process.exit(1);
}
const config = parsed.config;

const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL, logger);
const server = buildApp({ pool, logger }).listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "listening");
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

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
    pool
      .end()
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
