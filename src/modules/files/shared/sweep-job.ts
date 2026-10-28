import type { FileSweepJobConfigType } from '@/config/config.js';
import type { JobType } from '@/scheduler/index.js';
import type { FileStoreType } from '@/storage/index.js';
import { countOverdueFiles, sweepFiles } from './sweep.js';

/** The sweep as a scheduler job (Phase 5.5 spec, 4.3 "When it runs"; Phase 7 spec, 4.3). */
export function createFileSweepJob({ store, settings }: { store: FileStoreType; settings: FileSweepJobConfigType }): JobType {
  return {
    name: 'files.sweep',
    intervalMs: settings.intervalMs,
    settings,
    async run({ db, logger, signal }) {
      const overdue = await countOverdueFiles(db);
      if (overdue > 0) {
        logger.warn({ overdue }, 'files are past due for deletion: sweeps are failing');
      }
      return sweepFiles(db, store, {
        batchSize: settings.batchSize,
        budgetMs: settings.budgetMs,
        signal,
      });
    },
  };
}
