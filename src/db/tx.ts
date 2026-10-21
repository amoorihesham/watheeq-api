import type { Db, Tx } from "./pool.js";

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx);
  });
}
