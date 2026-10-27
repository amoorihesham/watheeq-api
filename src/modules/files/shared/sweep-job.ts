import type { JobType } from "@/scheduler/index.js";
import type { FileStoreType } from "@/storage/index.js";
import { SWEEP_INTERVAL_MS } from "../files.constants.js";
import { countOverdueFiles, sweepFiles } from "./sweep.js";

/** The sweep as a scheduler job (Phase 5.5 spec, 4.3 "When it runs"; Phase 7 spec, 4.3). */
export function createFileSweepJob({ store }: { store: FileStoreType }): JobType {
  return {
    name: "files.sweep",
    intervalMs: SWEEP_INTERVAL_MS,
    async run({ db, logger, signal }) {
      const overdue = await countOverdueFiles(db);
      if (overdue > 0) {
        logger.warn({ overdue }, "files are past due for deletion: sweeps are failing");
      }
      return sweepFiles(db, store, { signal });
    },
  };
}
