import type { JobsSettingType, JobType } from "./scheduler.types.js";

/** Reads the `JOBS` value: `all`, `none`, or comma-separated job names. Returns null when a name is empty. */
export function parseJobsSetting(value: string): JobsSettingType | null {
  const trimmed = value.trim();
  if (trimmed === "all" || trimmed === "none") {
    return trimmed;
  }
  const names = trimmed.split(",").map((name) => name.trim());
  return names.every((name) => name.length > 0) ? names : null;
}

/** The jobs a process runs. An unknown name throws, naming it, so the process refuses to start. */
export function selectJobs(setting: JobsSettingType, jobs: JobType[]): JobType[] {
  if (setting === "all") {
    return jobs;
  }
  if (setting === "none") {
    return [];
  }
  const unknown = setting.find((name) => !jobs.some((job) => job.name === name));
  if (unknown !== undefined) {
    throw new Error(
      `JOBS names an unknown job "${unknown}"; known jobs: ${jobs.map((job) => job.name).join(", ")}`,
    );
  }
  return jobs.filter((job) => setting.includes(job.name));
}
