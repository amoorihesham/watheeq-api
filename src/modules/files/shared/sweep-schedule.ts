import { SWEEP_INTERVAL_MS } from "../files.config.js";
import type { SweepScheduleDepsType, SweepScheduleType } from "../files.types.js";
import { countOverdueFiles, sweepFiles } from "./sweep.js";

/**
 * Runs `sweepFiles` once now, then again 15 minutes after each run finishes: a `setTimeout` chain, not
 * `setInterval`, so one instance never runs two sweeps at once however long a sweep takes (Phase 5.5 spec, 4.3).
 * A failed run is logged and never crashes the process.
 */
export function startFileSweeps({
  db,
  store,
  logger,
  intervalMs = SWEEP_INTERVAL_MS,
}: SweepScheduleDepsType): SweepScheduleType {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    try {
      const overdue = await countOverdueFiles(db);
      if (overdue > 0) {
        logger.warn({ overdue }, "files are past due for deletion: sweeps are failing");
      }
      const deleted = await sweepFiles(db, store, { signal: abort.signal });
      logger.info({ deleted }, "file sweep finished");
    } catch (err) {
      logger.error({ err }, "file sweep failed");
    }
    if (!abort.signal.aborted) {
      timer = setTimeout(() => {
        running = run();
      }, intervalMs);
    }
  }

  timer = setTimeout(() => {
    running = run();
  }, 0);

  return {
    async stop() {
      abort.abort();
      clearTimeout(timer);
      await running;
    },
  };
}
