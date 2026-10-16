import pg from "pg";
import type { Logger } from "../logging/logger.js";

export const HEALTH_TIMEOUT_MS = 2000;

export function createPool(connectionString: string, logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
  });
  // An idle client can fail (for example when PostgreSQL restarts).
  // Without a listener, Node would treat that as an uncaught exception and exit.
  pool.on("error", (err) => {
    logger.error({ err }, "idle database client error");
  });
  return pool;
}
