import { createTokenCleanupJob } from "./modules/auth/index.js";
import { createFileSweepJob } from "./modules/files/index.js";
import type { JobType } from "./scheduler/index.js";
import type { FileStoreType } from "./storage/index.js";

export interface JobsDepsType {
  fileStore: FileStoreType;
}

/** Every background job, composed from the modules' job factories as `app.ts` composes the routes. */
export function buildJobs({ fileStore }: JobsDepsType): JobType[] {
  return [createFileSweepJob({ store: fileStore }), createTokenCleanupJob()];
}
