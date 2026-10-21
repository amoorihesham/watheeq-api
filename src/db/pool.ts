import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Logger } from "../logging/logger.js";
import * as schema from "./schema/index.js";

export const HEALTH_TIMEOUT_MS = 2000;

export function createPool(connectionString: string, logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
  });

  pool.on("error", (err) => {
    logger.error({ err }, "idle database client error");
  });
  return pool;
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;
