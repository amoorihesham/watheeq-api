import { sql } from "drizzle-orm";
import {
  check,
  type PgTableExtraConfigValue,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** The urgency levels a requester chooses from, each with a deadline in working days (Phase 5 spec, D4). */
export const priorities = pgTable(
  "priorities",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    days: smallint().notNull(),
    // The place in the display order; null while retired. Not deferrable: a reorder clears it first.
    sortOrder: smallint("sort_order"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("priorities_tenant_id_unique").on(t.tenantId, t.id),
    // Nulls are distinct, so retired priorities do not collide.
    unique("priorities_sort_order_unique").on(t.tenantId, t.sortOrder),
    check("priorities_days_range", sql`${t.days} between 1 and 365`),
    check(
      "priorities_name_length",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`,
    ),
    check(
      "priorities_order_iff_active",
      sql`(${t.retiredAt} is null) = (${t.sortOrder} is not null)`,
    ),
    // Unique among active priorities, so restoring one can meet a name taken meanwhile (R5.15).
    uniqueIndex("priorities_name_unique")
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.retiredAt} is null`),
  ],
);
