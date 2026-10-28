import type { JobsConfigType } from './config/config.js';
import { createTokenCleanupJob } from './modules/auth/index.js';
import { createFileSweepJob } from './modules/files/index.js';
import { createNotificationsCleanupJob } from './modules/notifications/index.js';
import { createEscalationsJob } from './modules/requests/index.js';
import { createSubscriptionNoticesJob } from './modules/subscriptions/index.js';
import type { JobType } from './scheduler/index.js';
import type { FileStoreType } from './storage/index.js';

export interface JobsDepsType {
  fileStore: FileStoreType;
  jobs: JobsConfigType;
}

export function buildJobs({ fileStore, jobs }: JobsDepsType): JobType[] {
  return [
    createEscalationsJob(jobs.escalations),
    createSubscriptionNoticesJob(jobs.subscriptionNotices),
    createFileSweepJob({ store: fileStore, settings: jobs.fileSweep }),
    createTokenCleanupJob(jobs.tokenCleanup),
    createNotificationsCleanupJob(jobs.notificationsCleanup),
  ];
}
