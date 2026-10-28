import type { TokenCleanupJobConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { JobType } from '@/scheduler/index.js';
import { createAuthRepository } from '../auth.repository.js';

const repo = createAuthRepository();

interface TokenCleanupOptionsType {
  batchSize: number;
  signal?: AbortSignal;
}

/**
 * Deletes refresh tokens and password tokens whose `expires_at` has passed, revoked or used or not: nothing reads an
 * expired row (an expired link and an unknown one answer the same). Each batch is one statement; a table is done
 * when a batch comes up short, and a shutdown stops the run between batches (Phase 7 spec, R7.17).
 */
export async function deleteExpiredTokens(db: Db, { batchSize, signal }: TokenCleanupOptionsType): Promise<{ refreshTokens: number; passwordTokens: number }> {
  async function drain(deleteBatch: (limit: number) => Promise<unknown[]>): Promise<number> {
    let deleted = 0;
    while (!signal?.aborted) {
      const batch = await deleteBatch(batchSize);
      deleted += batch.length;
      if (batch.length < batchSize) {
        break;
      }
    }
    return deleted;
  }
  return {
    refreshTokens: await drain((limit) => repo.deleteExpiredRefreshTokens(db, limit)),
    passwordTokens: await drain((limit) => repo.deleteExpiredPasswordTokens(db, limit)),
  };
}

export function createTokenCleanupJob(settings: TokenCleanupJobConfigType): JobType {
  return {
    name: 'auth.token_cleanup',
    intervalMs: settings.intervalMs,
    settings,
    run: ({ db, signal }) => deleteExpiredTokens(db, { batchSize: settings.batchSize, signal }),
  };
}
