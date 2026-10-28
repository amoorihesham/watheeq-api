import type { Tx } from '@/db/pool.js';
import { auditLog } from '@/db/schema/index.js';
import type { AuditEntryType } from './audit.types.js';

/** Accepts only a transaction, so the entry commits or rolls back together with the change it describes (T8). */
export async function writeAuditEntry(tx: Tx, entry: AuditEntryType): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    reason: entry.reason ?? null,
    details: entry.details ?? null,
    requestId: entry.requestId,
  });
}
