import type { Db } from "@/db/pool.js";
import type { Logger } from "@/logging/logger.js";

export interface JobContextType {
  db: Db;
  /** Already tagged with the job name and run ID. */
  logger: Logger;
  /** Aborted on shutdown: a job stops between transactions. */
  signal: AbortSignal;
  runId: string;
}

export interface JobType {
  /** `<module>.<job>`, the name `JOBS` selects by. */
  name: string;
  /** The pause between the end of one run and the start of the next. */
  intervalMs: number;
  /** The effective settings of this job (interval, batch size, budget), logged at startup. Never secrets. */
  settings: Readonly<Record<string, number>>;
  /** Returns counts for the log line; a run with any non-zero count logs at info. */
  run(context: JobContextType): Promise<Record<string, number>>;
}

export interface SchedulerDepsType {
  jobs: JobType[];
  db: Db;
  logger: Logger;
}

export interface SchedulerType {
  /** Aborts the signal, clears the timers, and resolves once the runs in progress have ended. */
  stop(): Promise<void>;
}

/** The parsed `JOBS` setting. */
export type JobsSettingType = "all" | "none" | string[];
