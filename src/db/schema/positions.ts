import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orgUnits } from "./org-units.js";
import { tenants } from "./tenants.js";

/** The positions resolved from the request rather than held by anyone (Phase 5 spec, 4.1). */
export const assigneeBuiltins = pgEnum("assignee_builtins", [
  "handler",
  "requester",
  "handler_unit_managers",
  "handler_department_managers",
  "requester_unit_managers",
  "requester_department_managers",
]);

/** Named responsibilities placed in one org unit and held by members of that unit (Phase 5 spec, P5.3). */
export const positions = pgTable(
  "positions",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // Never changes; null only for a retired position whose unit was deleted.
    unitId: uuid("unit_id"),
    name: text().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("positions_tenant_id_unique").on(t.tenantId, t.id),
    // The target of tenant_members.position_id: a holder must sit in the position's own unit (R5.2).
    unique("positions_tenant_unit_id_unique").on(t.tenantId, t.unitId, t.id),
    foreignKey({
      name: "positions_unit_fk",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    check("positions_unit_or_retired", sql`${t.unitId} is not null or ${t.retiredAt} is not null`),
    check(
      "positions_name_length",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`,
    ),
    // Unique among active positions, so restoring one can meet a name taken meanwhile (R5.1, R5.15).
    uniqueIndex("positions_name_unique")
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.retiredAt} is null`),
  ],
);
