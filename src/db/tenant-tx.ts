import { sql } from "drizzle-orm";
import type { Db, Tx } from "./pool.js";

/**
 * Runs `fn` in a transaction whose tenant context is `tenantId`.
 * The setting is transaction-local, so it disappears at COMMIT or ROLLBACK.
 * The tenant id is a bind parameter, never concatenated into SQL.
 * If `fn` throws, the transaction rolls back and the error propagates.
 */
export async function withTenantTx<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
