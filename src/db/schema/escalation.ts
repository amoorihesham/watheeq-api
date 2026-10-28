import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, type PgTableExtraConfigValue, pgEnum, pgTable, primaryKey, smallint, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { assigneeBuiltins, positions } from './positions.js';
import { requests } from './requests.js';
import { tenants } from './tenants.js';

/** The three escalation rules (MVP scope 3.7): R0 before acceptance, R1 at a share of the deadline, R2 when late. */
export const escalationRules = pgEnum('escalation_rules', ['r0', 'r1', 'r2']);

/** One row per configured tenant; no row means "not configured" (Phase 5 spec, Q17). */
export const escalationSettings = pgTable(
  'escalation_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    r0Enabled: boolean('r0_enabled').notNull(),
    r0Days: smallint('r0_days').notNull(),
    r1Enabled: boolean('r1_enabled').notNull(),
    r1Percent: smallint('r1_percent').notNull(),
    r2Enabled: boolean('r2_enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [check('escalation_settings_r0_days_range', sql`${t.r0Days} between 1 and 30`), check('escalation_settings_r1_percent_range', sql`${t.r1Percent} between 1 and 99`)],
);

/** Who is told when a rule fires; kept for a rule that is off, so turning it on again loses nothing. */
export const escalationRecipients = pgTable(
  'escalation_recipients',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    rule: escalationRules().notNull(),
    targetPositionId: uuid('target_position_id'),
    targetBuiltin: assigneeBuiltins('target_builtin'),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'escalation_recipients_position_fk',
      columns: [t.tenantId, t.targetPositionId],
      foreignColumns: [positions.tenantId, positions.id],
    }),
    check('escalation_recipients_one_target', sql`num_nonnulls(${t.targetPositionId}, ${t.targetBuiltin}) = 1`),
    // A plain unique would treat the null target column as distinct, so each target kind has its own index.
    uniqueIndex('escalation_recipients_position_unique').on(t.tenantId, t.rule, t.targetPositionId).where(sql`${t.targetPositionId} is not null`),
    uniqueIndex('escalation_recipients_builtin_unique').on(t.tenantId, t.rule, t.targetBuiltin).where(sql`${t.targetBuiltin} is not null`),
  ],
);

/**
 * One row per rule that fired on a request. The primary key makes "at most once" (D9) a database fact across
 * instances: a second insert does nothing (Phase 7 spec, 4.1).
 */
export const requestEscalations = pgTable(
  'request_escalations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    requestId: uuid('request_id').notNull(),
    rule: escalationRules().notNull(),
    // When the threshold passed; differs from `firedAt` when the check was not running (R7.6).
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'request_escalations_pk', columns: [t.requestId, t.rule] }),
    foreignKey({
      name: 'request_escalations_request_fk',
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
  ],
);
