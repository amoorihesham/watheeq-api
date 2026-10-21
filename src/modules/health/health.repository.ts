import type pg from "pg";
import { HEALTH_TIMEOUT_MS } from "@/db/pool.js";

/** Takes the pool (not an executor): the ping needs a deadline and must not wait for a free connection. */
export function createHealthRepository(pool: pg.Pool) {
  return {
    async isDbUp(): Promise<boolean> {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("health check timed out")), HEALTH_TIMEOUT_MS);
      });
      try {
        await Promise.race([pool.query("SELECT 1"), timeout]);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
