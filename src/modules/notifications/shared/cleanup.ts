import type { NotificationsCleanupJobConfigType } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { JobType } from "@/scheduler/index.js";
import { RETENTION_DAYS } from "../notifications.constants.js";
import { createNotificationsRepository } from "../notifications.repository.js";

const repo = createNotificationsRepository();

/**
 * Deletes notifications read more than 90 days ago, a batch per statement until one comes up short; unread ones are
 * kept however old. A shutdown stops the run between batches (Phase 7 spec, R7.16).
 */
export async function deleteOldReadNotifications(
  db: Db,
  { batchSize, signal }: { batchSize: number; signal?: AbortSignal },
): Promise<{ deleted: number }> {
  let deleted = 0;
  while (!signal?.aborted) {
    const batch = await repo.deleteReadBefore(db, RETENTION_DAYS, batchSize);
    deleted += batch.length;
    if (batch.length < batchSize) {
      break;
    }
  }
  return { deleted };
}

export function createNotificationsCleanupJob(
  settings: NotificationsCleanupJobConfigType,
): JobType {
  return {
    name: "notifications.cleanup",
    intervalMs: settings.intervalMs,
    settings,
    run: ({ db, signal }) =>
      deleteOldReadNotifications(db, { batchSize: settings.batchSize, signal }),
  };
}
