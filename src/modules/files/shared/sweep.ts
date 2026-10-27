import type { Db } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import type { FileStoreType } from "@/storage/index.js";
import { SWEEP_BATCH_SIZE, SWEEP_BUDGET_MS } from "../files.constants.js";
import { createFilesRepository } from "../files.repository.js";
import type { SweepOptionsType, SweepResultType } from "../files.types.js";
import { storageKeyOf } from "./keys.js";

const repo = createFilesRepository();

/**
 * Deletes the files nobody needs (Phase 5.5 spec, 4.3 "Cleanup"): discarded files, pending uploads past 24 hours,
 * and uploads that died midway. Works in batches, each its own transaction: lock up to 100 rows (`SKIP LOCKED`, so
 * several instances split the work), delete their bytes with one store request, delete the rows, commit. If the
 * store fails the batch rolls back and no row disappears while its bytes remain. Stops when a batch comes up short
 * or the time budget is spent; the rest waits for the next run.
 */
export async function sweepFiles(
  db: Db,
  store: FileStoreType,
  { batchSize = SWEEP_BATCH_SIZE, budgetMs = SWEEP_BUDGET_MS, signal }: SweepOptionsType = {},
): Promise<SweepResultType> {
  const result: SweepResultType = { discarded: 0, expired: 0, abandoned: 0 };
  const startedAt = Date.now();
  while (!signal?.aborted && Date.now() - startedAt < budgetMs) {
    const batch = await withTx(db, async (tx) => {
      const { rows } = await repo.lockDue(tx, batchSize);
      if (rows.length > 0) {
        await store.delete(rows.map((row) => storageKeyOf(row.tenant_id, row.id)));
        await repo.deleteByIds(
          tx,
          rows.map((row) => row.id),
        );
      }
      return rows;
    });
    for (const row of batch) {
      result[row.kind] += 1;
    }
    if (batch.length < batchSize) {
      break;
    }
  }
  return result;
}

/** How many files are more than an hour past due: sweeps are failing when this is not zero. */
export async function countOverdueFiles(db: Db): Promise<number> {
  const { rows } = await repo.countOverdue(db);
  return rows[0]?.overdue ?? 0;
}
