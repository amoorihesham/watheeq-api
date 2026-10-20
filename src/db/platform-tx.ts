import { sql } from "drizzle-orm";
import type { Db, Tx } from "./pool.js";

/**
 * Sees every tenant's rows (Phase 1 spec 4.1, `app_row_visible()`).
 * Only `src/modules/platform/` may import this; enforced by test/architecture.test.ts.
 */
export async function withPlatformTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform', 'on', true)`);
    return fn(tx);
  });
}
