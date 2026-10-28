import { sql } from 'drizzle-orm';
import { check, foreignKey, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const orgUnitKinds = pgEnum('org_unit_kinds', ['department', 'section']);

/** Departments and sections; the organization itself is the tenant (Phase 2 spec, P2.1). */
export const orgUnits = pgTable(
  'org_units',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // Never changes after creation, so "a section's parent is a department" cannot be broken by a later write.
    kind: orgUnitKinds().notNull(),
    parentId: uuid('parent_id'),
    name: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The target of the composite foreign keys that keep parents and members inside one tenant (P2.2).
    unique('org_units_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'org_units_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check('org_units_shape', sql`(${t.kind} = 'department') = (${t.parentId} is null)`),
    check('org_units_name_length', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`),
    // Sibling names are unique ignoring case (R2.3); both map to 409 UNIT_NAME_TAKEN in src/http/errors.ts.
    uniqueIndex('org_units_department_name_unique').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.parentId} is null`),
    uniqueIndex('org_units_section_name_unique').on(t.parentId, sql`lower(${t.name})`).where(sql`${t.parentId} is not null`),
  ],
);
