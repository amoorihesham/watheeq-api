import { sql } from "drizzle-orm";
import type { Tx } from "../db/pool.js";
import { auditLog } from "../db/schema/index.js";

export type AuditActor =
  | { type: "user" | "operator"; id: string }
  | { type: "system"; id?: string | null };

/** Who did it and which request it came from. Built once per request. */
export interface AuditContext {
  actor: AuditActor;
  requestId: string;
}

export interface AuditEntry {
  /** Dotted name, for example `user.deactivated`. */
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
  /** Before/after values where useful. Never put secrets here. */
  details?: Record<string, unknown>;
}

/**
 * Appends an audit entry inside the caller's tenant transaction.
 * Accepting only `Tx` (not `Db`) makes a call outside a transaction a compile error,
 * so the entry commits or rolls back together with the change it describes.
 * The tenant is read from the transaction's context by the database (`app_current_tenant()`),
 * so there is no way to pass one, and a missing context makes the insert fail.
 */
export async function audit(tx: Tx, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: sql`app_current_tenant()`,
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
