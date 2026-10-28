import { sql } from 'drizzle-orm';
import { bigint, check, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const paymentPeriods = pgEnum('payment_periods', ['monthly', 'yearly']);

export const plans = pgTable(
  'plans',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    userLimit: integer('user_limit').notNull(),
    // Whole GB of stored files; the default is what plans that existed before the limit got (Phase 5.5 spec, Q13).
    storageLimitGb: integer('storage_limit_gb').notNull().default(10),
    graceDays: integer('grace_days').notNull(),
    // Halalas per payment period (1 SAR = 100 halalas), so amounts never pass through floating point.
    priceHalalas: bigint('price_halalas', { mode: 'number' }).notNull(),
    paymentPeriod: paymentPeriods('payment_period').notNull(),
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Basic" and "basic" are the same plan name; mapped to 409 PLAN_NAME_TAKEN in src/http/errors.ts.
    uniqueIndex('plans_name_lower_unique').on(sql`lower(${t.name})`),
    check('plans_name_length', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`),
    check('plans_user_limit', sql`${t.userLimit} >= 1`),
    check('plans_storage_limit', sql`${t.storageLimitGb} between 1 and 100000`),
    check('plans_grace_days', sql`${t.graceDays} between 0 and 365`),
    check('plans_price', sql`${t.priceHalalas} >= 0`),
    check('plans_discount', sql`${t.discountPercent} between 0 and 100`),
  ],
);
