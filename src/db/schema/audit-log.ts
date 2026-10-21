import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // Null marks a platform-level entry (Phase 0 spec, P0.2).
    tenantId: uuid("tenant_id").references(() => tenants.id),
    // The transaction start time, so entries of one transaction share a timestamp.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text().notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    reason: text(),
    details: jsonb(),
    requestId: text("request_id").notNull(),
  },
  (t) => [
    // Reading one tenant's history in time order is a range scan on this index.
    index("audit_log_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    index("audit_log_platform_occurred_idx").on(t.occurredAt).where(sql`${t.tenantId} is null`),
    check("audit_log_actor_type", sql`${t.actorType} in ('user', 'operator', 'system')`),
    check("audit_log_actor_id", sql`${t.actorType} = 'system' or ${t.actorId} is not null`),
    check("audit_log_user_has_tenant", sql`${t.tenantId} is not null or ${t.actorType} <> 'user'`),
  ],
);
