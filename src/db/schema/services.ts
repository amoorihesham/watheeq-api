import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, type PgTableExtraConfigValue, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FormFieldType } from '@/modules/services/shared/form.js';
import { tenants } from './tenants.js';
import { workflows } from './workflows.js';

/** What a tenant's legal team offers; requesters choose one when they submit (Phase 5 spec, P5.1). */
export const services = pgTable(
  'services',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    form: jsonb().$type<FormFieldType[]>().notNull().default([]),
    formRevision: integer('form_revision').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('services_tenant_id_unique').on(t.tenantId, t.id),
    check('services_name_length', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`),
    check('services_description_length', sql`${t.description} is null or char_length(${t.description}) <= 2000`),
    check('services_form_is_array', sql`jsonb_typeof(${t.form}) = 'array'`),
    // Unique among active services, so restoring one can meet a name taken meanwhile (R5.15).
    uniqueIndex('services_name_unique').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.retiredAt} is null`),
  ],
);

/** The workflows a service allows, one of them the default; "at least one, exactly one default" is checked by the service. */
export const serviceWorkflows = pgTable(
  'service_workflows',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    serviceId: uuid('service_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    isDefault: boolean('is_default').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'service_workflows_pk', columns: [t.serviceId, t.workflowId] }),
    foreignKey({
      name: 'service_workflows_service_fk',
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: 'service_workflows_workflow_fk',
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    uniqueIndex('service_workflows_one_default').on(t.serviceId).where(sql`${t.isDefault}`),
    // The workflow retire asks which services allow it.
    index('service_workflows_workflow_idx').on(t.workflowId),
  ],
);
