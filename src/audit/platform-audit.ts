import type { Tx } from "../db/pool.js";
import { auditLog } from "../db/schema/index.js";
import type { AuditContext, AuditEntry } from "./audit.js";

export interface PlatformAuditEntry extends AuditEntry {
  /** `null` for a platform-level action, such as a plan edit. */
  tenantId: string | null;
}

/** A platform transaction has no tenant context, so unlike `audit`, the tenant comes from the entry. */
export async function platformAudit(
  tx: Tx,
  ctx: AuditContext,
  entry: PlatformAuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    reason: entry.reason ?? null,
    details: entry.details ?? null,
    requestId: ctx.requestId,
  });
}
