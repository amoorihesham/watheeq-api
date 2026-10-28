import type { Tx } from '@/db/pool.js';
import { createNotificationsRepository } from '../notifications.repository.js';
import type { NotifyInputType } from '../notifications.types.js';

const repo = createNotificationsRepository();

/**
 * Writes one notification per recipient in the caller's transaction, so it commits or rolls back with the event
 * it reports (T8, R7.11). Accepts only a transaction, as `writeAuditEntry` does. The caller decides who is told;
 * the actor, duplicates, and inactive or foreign members are dropped here.
 */
export async function notify(tx: Tx, input: NotifyInputType): Promise<void> {
  const candidates = [...new Set(input.recipients)].filter((id) => id !== input.actorId);
  if (candidates.length === 0) {
    return;
  }
  const recipients = await repo.activeMemberIds(tx, input.tenantId, candidates);
  if (recipients.length === 0) {
    return;
  }
  await repo.insertMany(
    tx,
    recipients.map((userId) => ({
      tenantId: input.tenantId,
      userId,
      kind: input.kind,
      requestId: input.requestId ?? null,
      data: input.data,
    })),
  );
}
