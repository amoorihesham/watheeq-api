import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export const HEALTH_TIMEOUT_MS = 2000;

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
  });
  // An idle client can fail (for example when PostgreSQL restarts).
  // Without a listener, Node would treat that as an uncaught exception and exit.
  pool.on("error", () => {});
  return pool;
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
