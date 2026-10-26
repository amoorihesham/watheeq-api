import { randomUUID } from "node:crypto";
import type { JobType, SchedulerDepsType, SchedulerType } from "./scheduler.types.js";

/**
 * Runs each job once now, then again `intervalMs` after each run ends: a `setTimeout` chain per job, never
 * `setInterval`, so a job never overlaps itself however long it takes and a slow job never delays another
 * (Phase 7 spec, 4.3 "The scheduler"). A failed run is logged and the chain continues.
 */
export function startScheduler({ jobs, db, logger }: SchedulerDepsType): SchedulerType {
  const abort = new AbortController();
  const timers = new Set<NodeJS.Timeout>();
  const chains = new Set<Promise<void>>();

  async function runOnce(job: JobType): Promise<void> {
    const runId = `job:${job.name}:${randomUUID()}`;
    const log = logger.child({ job: job.name, runId });
    try {
      const counts = await job.run({ db, logger: log, signal: abort.signal, runId });
      const didSomething = Object.values(counts).some((count) => count !== 0);
      log[didSomething ? "info" : "debug"]({ counts }, "job finished");
    } catch (err) {
      log.error({ err }, "job failed");
    }
  }

  function chain(job: JobType): void {
    const link = runOnce(job).then(() => {
      chains.delete(link);
      if (abort.signal.aborted) {
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        chain(job);
      }, job.intervalMs);
      timers.add(timer);
    });
    chains.add(link);
  }

  for (const job of jobs) {
    chain(job);
  }

  return {
    async stop() {
      abort.abort();
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      await Promise.all(chains);
    },
  };
}
