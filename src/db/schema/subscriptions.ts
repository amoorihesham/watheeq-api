import { sql } from 'drizzle-orm';
import { bigint, check, date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { paymentPeriods, plans } from './plans.js';
import { tenants } from './tenants.js';

/** One row per tenant, updated in place; the history is the audit log (Phase 1 spec, P1.3). */
export const subscriptions = pgTable(
  'subscriptions',
  {
    // The primary key makes "exactly one subscription per tenant" a database fact (R1.5).
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    // The plan's terms, copied at assignment so later plan edits never change them (D14).
    planName: text('plan_name').notNull(),
    userLimit: integer('user_limit').notNull(),
    storageLimitGb: integer('storage_limit_gb').notNull().default(10),
    graceDays: integer('grace_days').notNull(),
    priceHalalas: bigint('price_halalas', { mode: 'number' }).notNull(),
    paymentPeriod: paymentPeriods('payment_period').notNull(),
    planDiscountPercent: numeric('plan_discount_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }).notNull(),
    customerDiscountPercent: numeric('customer_discount_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('subscriptions_user_limit', sql`${t.userLimit} >= 1`),
    check('subscriptions_storage_limit', sql`${t.storageLimitGb} between 1 and 100000`),
    check('subscriptions_grace_days', sql`${t.graceDays} >= 0`),
    check('subscriptions_price', sql`${t.priceHalalas} >= 0`),
    check('subscriptions_plan_discount', sql`${t.planDiscountPercent} between 0 and 100`),
    check('subscriptions_customer_discount', sql`${t.customerDiscountPercent} between 0 and 100`),
    check('subscriptions_period', sql`${t.endDate} >= ${t.startDate}`),
  ],
);
