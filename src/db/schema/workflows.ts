import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, type PgTableExtraConfigValue, pgEnum, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { assigneeBuiltins, positions } from './positions.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/** What a stage does when it resolves to nobody (Phase 5 spec, P5.6). */
export const stageFallbacks = pgEnum('stage_fallbacks', ['escalate', 'skip', 'hold']);

/** A workflow's identity and name; its stages live in immutable versions (Phase 5 spec, P5.4). */
export const workflows = pgTable(
  'workflows',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    // Its foreign key is deferrable and initially deferred (migration 0010): a workflow and its first version
    // are inserted together.
    currentVersionId: uuid('current_version_id').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('workflows_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'workflows_current_version_fk',
      columns: [t.tenantId, t.id, t.currentVersionId],
      foreignColumns: [workflowVersions.tenantId, workflowVersions.workflowId, workflowVersions.id],
    }),
    check('workflows_name_length', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`),
    // Unique among active workflows, so restoring one can meet a name taken meanwhile (R5.15).
    uniqueIndex('workflows_name_unique').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.retiredAt} is null`),
  ],
);

/** One saved definition of a workflow; never updated (Phase 5 spec, 4.1). */
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id').notNull(),
    number: integer().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('workflow_versions_tenant_id_unique').on(t.tenantId, t.id),
    // The target of workflows.current_version_id: the current version must belong to the workflow itself.
    unique('workflow_versions_tenant_workflow_id_unique').on(t.tenantId, t.workflowId, t.id),
    unique('workflow_versions_number_unique').on(t.workflowId, t.number),
    foreignKey({
      name: 'workflow_versions_workflow_fk',
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    check('workflow_versions_number_positive', sql`${t.number} >= 1`),
  ],
);

/** The ordered steps of one version; never updated. Phase 6 request stages reference them. */
export const workflowStages = pgTable(
  'workflow_stages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    versionId: uuid('version_id').notNull(),
    ordinal: smallint().notNull(),
    name: text().notNull(),
    targetPositionId: uuid('target_position_id'),
    targetBuiltin: assigneeBuiltins('target_builtin'),
    whenUnresolved: stageFallbacks('when_unresolved').notNull(),
    handlerMayNarrow: boolean('handler_may_narrow').notNull(),
    handlerMayEscalate: boolean('handler_may_escalate').notNull(),
    excludeParties: boolean('exclude_parties').notNull(),
  },
  (t) => [
    // Lets a request stage be required to belong to the request's own version (Phase 6).
    unique('workflow_stages_tenant_version_id_unique').on(t.tenantId, t.versionId, t.id),
    unique('workflow_stages_ordinal_unique').on(t.versionId, t.ordinal),
    uniqueIndex('workflow_stages_name_unique').on(t.versionId, sql`lower(${t.name})`),
    foreignKey({
      name: 'workflow_stages_version_fk',
      columns: [t.tenantId, t.versionId],
      foreignColumns: [workflowVersions.tenantId, workflowVersions.id],
    }),
    foreignKey({
      name: 'workflow_stages_position_fk',
      columns: [t.tenantId, t.targetPositionId],
      foreignColumns: [positions.tenantId, positions.id],
    }),
    check('workflow_stages_ordinal_range', sql`${t.ordinal} between 1 and 20`),
    check('workflow_stages_name_length', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`),
    check('workflow_stages_one_target', sql`num_nonnulls(${t.targetPositionId}, ${t.targetBuiltin}) = 1`),
    // Nobody is "narrowed" or excluded from a stage that is simply the handler or the requester.
    check(
      'workflow_stages_party_flags',
      sql`${t.targetBuiltin} is null or ${t.targetBuiltin} not in ('handler', 'requester')
        or (not ${t.handlerMayNarrow} and not ${t.excludeParties})`,
    ),
  ],
);
