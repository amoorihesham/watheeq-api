export type AuditActorType = { type: 'user' | 'operator'; id: string } | { type: 'system'; id?: string | null };

export interface AuditEntryType {
  /** The affected tenant, or null for a platform-level entry such as a plan change. */
  tenantId: string | null;
  actor: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
  details?: Record<string, unknown>;
  requestId: string;
}

/** Who acted, and in which request: built once per request by `auditContextOf(req)` and passed to services. */
export interface AuditContextType {
  actor: AuditActorType;
  requestId: string;
}
