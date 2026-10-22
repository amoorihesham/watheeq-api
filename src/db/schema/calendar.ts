import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { WeekShapeType } from "@/modules/calendar/calendar.types.js";
import { tenants } from "./tenants.js";

export const calendarPeriodKinds = pgEnum("calendar_period_kinds", ["holiday", "season"]);
export const calendarRecurrences = pgEnum("calendar_recurrences", ["once", "gregorian", "hijri"]);
export const calendarOverrideActions = pgEnum("calendar_override_actions", ["move", "skip"]);

/** Versions of a tenant's normal hours; the one in force on a date is the latest effective by then (R4.3). */
export const workingHours = pgTable(
  "working_hours",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    effectiveFrom: date("effective_from").notNull(),
    // A week shape, validated by zod (P4.11).
    week: jsonb().$type<WeekShapeType>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.effectiveFrom] }),
    check("working_hours_week_object", sql`jsonb_typeof(${t.week}) = 'object'`),
  ],
);

/** Versions of holidays and seasons (P4.5, P4.8). */
export const calendarPeriods = pgTable(
  "calendar_periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: calendarPeriodKinds().notNull(),
    name: text().notNull(),
    recurrence: calendarRecurrences().notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    startMonth: smallint("start_month"),
    startDay: smallint("start_day"),
    endMonth: smallint("end_month"),
    endDay: smallint("end_day"),
    week: jsonb().$type<WeekShapeType>(),
    rank: smallint(),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    replacesId: uuid("replaces_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("calendar_periods_tenant_id_unique").on(t.tenantId, t.id),
    check(
      "calendar_periods_name_length",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`,
    ),
    // Exactly the columns of the row's recurrence are set.
    check(
      "calendar_periods_dates",
      sql`case when ${t.recurrence} = 'once'
        then ${t.startDate} is not null and ${t.endDate} is not null and ${t.startDate} <= ${t.endDate}
          and num_nulls(${t.startMonth}, ${t.startDay}, ${t.endMonth}, ${t.endDay}, ${t.validFrom}, ${t.validUntil}) = 6
        else num_nulls(${t.startDate}, ${t.endDate}) = 2
          and num_nonnulls(${t.startMonth}, ${t.startDay}, ${t.endMonth}, ${t.endDay}, ${t.validFrom}) = 5
          and ${t.startMonth} between 1 and 12 and ${t.endMonth} between 1 and 12
          and ${t.startDay} between 1 and 31 and ${t.endDay} between 1 and 31
          and (${t.validUntil} is null or ${t.validFrom} <= ${t.validUntil})
        end`,
    ),
    check(
      "calendar_periods_season",
      sql`(${t.kind} = 'season') = (${t.week} is not null and ${t.rank} is not null)
        and (${t.week} is null or jsonb_typeof(${t.week}) = 'object')
        and (${t.kind} = 'season' or num_nulls(${t.week}, ${t.rank}) = 2)`,
    ),
  ],
);

/** One-year adjustments of recurring periods (R4.7). */
export const calendarPeriodOverrides = pgTable(
  "calendar_period_overrides",
  {
    tenantId: uuid("tenant_id").notNull(),
    periodId: uuid("period_id").notNull(),
    // In the period's own calendar: a Gregorian or a Hijri year.
    year: integer().notNull(),
    action: calendarOverrideActions().notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.year] }),
    foreignKey({
      name: "calendar_period_overrides_period_fk",
      columns: [t.tenantId, t.periodId],
      foreignColumns: [calendarPeriods.tenantId, calendarPeriods.id],
    }).onDelete("cascade"),
    check(
      "calendar_period_overrides_dates",
      sql`case when ${t.action} = 'move'
        then ${t.startDate} is not null and ${t.endDate} is not null and ${t.startDate} <= ${t.endDate}
        else num_nulls(${t.startDate}, ${t.endDate}) = 2
        end`,
    ),
  ],
);
