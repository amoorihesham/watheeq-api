import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
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
    // It also serves the RLS filter on tenant_id.
    index("audit_log_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    check("audit_log_actor_type", sql`${t.actorType} in ('user', 'operator', 'system')`),
    // Only a system actor may have no id.
    check("audit_log_actor_id", sql`${t.actorType} = 'system' or ${t.actorId} is not null`),
  ],
);
