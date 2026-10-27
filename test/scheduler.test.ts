import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/pool.js";
import { buildJobs } from "../src/jobs.js";
import {
  type JobContextType,
  type JobType,
  parseJobsSetting,
  type SchedulerType,
  selectJobs,
  startScheduler,
} from "../src/scheduler/index.js";
import type { FileStoreType } from "../src/storage/index.js";
import { testConfig } from "./helpers/config.js";
import { captureLogs } from "./helpers/log-capture.js";

// Phase 7 spec, 4.3 "The scheduler": the scheduler needs no database of its own, only the one it hands to jobs.
const db = {} as Db;

function job(overrides: Partial<JobType> & Pick<JobType, "run">): JobType {
  return { name: "test.job", intervalMs: 1000, settings: {}, ...overrides };
}

// Runs still waiting for the test to end them; released after each test so `stop` can finish.
let waiting: (() => void)[] = [];

/** A run that ends when the test says so. */
function controlledRuns() {
  let started = 0;
  let concurrent = 0;
  let overlapped = false;
  return {
    run: async () => {
      started += 1;
      concurrent += 1;
      overlapped ||= concurrent > 1;
      await new Promise<void>((resolve) => waiting.push(resolve));
      concurrent -= 1;
      return {};
    },
    started: () => started,
    overlapped: () => overlapped,
    finishOne: async () => {
      waiting.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

let scheduler: SchedulerType | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  waiting = [];
});

afterEach(async () => {
  for (const release of waiting) {
    release();
  }
  await scheduler?.stop();
  scheduler = undefined;
  vi.useRealTimers();
});

describe("startScheduler", () => {
  it("runs each job once at start, then again an interval after each run ends", async () => {
    const run = vi.fn(async () => ({}));
    scheduler = startScheduler({
      jobs: [job({ run, intervalMs: 1000 })],
      db,
      logger: captureLogs().logger,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("runs a job built from a configured short interval again after that interval (R9.4)", async () => {
    const run = vi.fn(async () => ({}));
    const configured = buildJobs({
      fileStore: {} as FileStoreType,
      jobs: testConfig({ JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS: "2000" }).jobs,
    }).find((entry) => entry.name === "subscriptions.notices");
    expect(configured?.intervalMs).toBe(2000);
    scheduler = startScheduler({
      jobs: configured ? [{ ...configured, run }] : [],
      db,
      logger: captureLogs().logger,
    });
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("hands each run its database, a signal, and a run ID of the form job:<name>:<uuid>", async () => {
    const contexts: JobContextType[] = [];
    scheduler = startScheduler({
      jobs: [
        job({
          name: "files.sweep",
          run: async (context) => {
            contexts.push(context);
            return {};
          },
        }),
      ],
      db,
      logger: captureLogs().logger,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.db).toBe(db);
    expect(contexts[0]?.signal.aborted).toBe(false);
    expect(contexts[0]?.runId).toMatch(/^job:files\.sweep:[0-9a-f-]{36}$/);
    expect(contexts[0]?.runId).not.toBe(contexts[1]?.runId);
  });

  it("never starts a run while the previous one is still going, even when it outlasts the interval", async () => {
    const runs = controlledRuns();
    scheduler = startScheduler({
      jobs: [job({ run: runs.run, intervalMs: 100 })],
      db,
      logger: captureLogs().logger,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs.started()).toBe(1);

    await runs.finishOne();
    await vi.advanceTimersByTimeAsync(99);
    expect(runs.started()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs.started()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runs.started()).toBe(2);
    expect(runs.overlapped()).toBe(false);
  });

  it("does not let a slow job delay another", async () => {
    const slow = controlledRuns();
    const fast = vi.fn(async () => ({}));
    scheduler = startScheduler({
      jobs: [
        job({ name: "slow.job", run: slow.run, intervalMs: 100 }),
        job({ name: "fast.job", run: fast, intervalMs: 100 }),
      ],
      db,
      logger: captureLogs().logger,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow.started()).toBe(1);
    expect(fast).toHaveBeenCalledTimes(11);
  });

  it("logs a thrown run at error with the job name and run ID, and keeps the chain", async () => {
    const capture = captureLogs("debug");
    let calls = 0;
    scheduler = startScheduler({
      jobs: [
        job({
          name: "requests.escalations",
          run: async () => {
            calls += 1;
            if (calls === 1) {
              throw new Error("calendar beyond the ICU range");
            }
            return { fired: 1 };
          },
        }),
      ],
      db,
      logger: capture.logger,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);

    const failed = capture.lines().find((line) => line.msg === "job failed");
    expect(failed).toMatchObject({
      level: 50,
      job: "requests.escalations",
      runId: expect.stringMatching(/^job:requests\.escalations:/),
    });
    expect(JSON.stringify(failed)).toContain("calendar beyond the ICU range");
    expect(capture.lines().some((line) => line.msg === "job finished")).toBe(true);
  });

  it("logs a run with any non-zero count at info and an empty run at debug", async () => {
    const capture = captureLogs("debug");
    const results = [
      { fired: 0, skipped: 0 },
      { fired: 2, skipped: 0 },
      { fired: 0, skipped: 1 },
    ];
    let calls = 0;
    scheduler = startScheduler({
      jobs: [job({ run: async () => results[calls++] ?? { fired: 0 } })],
      db,
      logger: capture.logger,
    });
    await vi.advanceTimersByTimeAsync(2000);

    const finished = capture.lines().filter((line) => line.msg === "job finished");
    expect(finished.map((line) => [line.level, line.counts])).toEqual([
      [20, { fired: 0, skipped: 0 }],
      [30, { fired: 2, skipped: 0 }],
      [30, { fired: 0, skipped: 1 }],
    ]);
  });

  it("writes nothing at the default level for an empty run", async () => {
    const capture = captureLogs("info");
    scheduler = startScheduler({
      jobs: [job({ run: async () => ({ fired: 0 }) })],
      db,
      logger: capture.logger,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(capture.lines()).toEqual([]);
  });

  it("stop aborts the signal, waits for a run in progress, and prevents any further run", async () => {
    let signal: AbortSignal | undefined;
    let release: () => void = () => {};
    let calls = 0;
    scheduler = startScheduler({
      jobs: [
        job({
          run: async (context) => {
            calls += 1;
            signal = context.signal;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return {};
          },
        }),
      ],
      db,
      logger: captureLogs().logger,
    });
    expect(calls).toBe(1);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });

  it("stop clears a pending timer so a waiting job never runs again", async () => {
    const run = vi.fn(async () => ({}));
    scheduler = startScheduler({ jobs: [job({ run })], db, logger: captureLogs().logger });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts nothing for an empty job list", async () => {
    scheduler = startScheduler({ jobs: [], db, logger: captureLogs().logger });
    expect(vi.getTimerCount()).toBe(0);
    await scheduler.stop();
  });
});

describe("selectJobs", () => {
  const jobs = ["files.sweep", "auth.token_cleanup", "requests.escalations"].map((name) =>
    job({ name, run: async () => ({}) }),
  );
  const names = (selected: JobType[]) => selected.map((selectedJob) => selectedJob.name);

  it("all selects every job", () => {
    expect(names(selectJobs("all", jobs))).toEqual(names(jobs));
  });

  it("none selects nothing", () => {
    expect(selectJobs("none", jobs)).toEqual([]);
  });

  it("a list selects the named jobs", () => {
    expect(names(selectJobs(["requests.escalations", "files.sweep"], jobs))).toEqual([
      "files.sweep",
      "requests.escalations",
    ]);
  });

  it("an unknown name throws, naming it", () => {
    expect(() => selectJobs(["files.sweep", "files.swep"], jobs)).toThrow(/"files\.swep"/);
  });
});

describe("parseJobsSetting", () => {
  it("reads all, none, and lists with surrounding spaces", () => {
    expect(parseJobsSetting("all")).toBe("all");
    expect(parseJobsSetting(" none ")).toBe("none");
    expect(parseJobsSetting("a.b, c.d")).toEqual(["a.b", "c.d"]);
  });

  it("refuses an empty name", () => {
    expect(parseJobsSetting("")).toBeNull();
    expect(parseJobsSetting("a.b,,c.d")).toBeNull();
  });
});
