import type { Db } from '@/db/pool.js';
import { toSubscriptionView, toUsage } from './shared/view.js';
import type { GetSubscriptionResponseType, SubscriptionsRepositoryType } from './subscriptions.types.js';

export function createSubscriptionsService({ db, repo }: { db: Db; repo: SubscriptionsRepositoryType }) {
  return {
    /** Everything the tenant's subscription holds, for its Tenant Admin (R1.11, P1.23). */
    async get(tenantId: string): Promise<GetSubscriptionResponseType> {
      const [row] = await repo.findByTenantId(db, tenantId);
      if (!row) {
        throw new Error(`tenant ${tenantId} has no subscription`);
      }
      const today = (await repo.today(db)).rows[0]?.today ?? '';
      const [usage] = await repo.countActiveMembers(db, tenantId);
      const [stored] = await repo.sumStoredBytes(db, tenantId);
      return {
        subscription: toSubscriptionView(row, today),
        usage: toUsage(usage?.activeUsers ?? 0, stored?.storedBytes ?? 0, row),
      };
    },
  };
}
