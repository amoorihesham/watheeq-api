import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orgUnits } from './org-units.js';
import { positions } from './positions.js';
import { roles } from './roles.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id').notNull(),
    // Null: directly under the organization (Phase 2 spec, P2.13).
    unitId: uuid('unit_id'),
    // Managers are members of the unit they manage, so the flag lives on the membership (Phase 2 spec, P2.3).
    isManager: boolean('is_manager').notNull().default(false),
    // The position the member holds; one column means one position per person (Phase 5 spec, R5.2).
    positionId: uuid('position_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    // One membership per user: a user belongs to exactly one tenant (T5).
    uniqueIndex('tenant_members_user_unique').on(t.userId),
    // Includes tenant_id, so a member can only be placed in a unit of their own tenant (P2.2).
    foreignKey({
      name: 'tenant_members_unit_fk',
      columns: [t.tenantId, t.unitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    index('tenant_members_unit_idx').on(t.tenantId, t.unitId),
    // Includes tenant_id, so a member can only hold a role of their own tenant.
    foreignKey({
      name: 'tenant_members_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
    index('tenant_members_role_idx').on(t.tenantId, t.roleId),
    // Includes unit_id, so the database refuses a holder outside the position's unit, and a move that forgets
    // to clear the position (R5.2, R5.3).
    foreignKey({
      name: 'tenant_members_position_fk',
      columns: [t.tenantId, t.unitId, t.positionId],
      foreignColumns: [positions.tenantId, positions.unitId, positions.id],
    }),
    // A foreign key with a null column is not checked, so a holder with no unit would escape the key above.
    check('tenant_members_position_has_unit', sql`${t.positionId} is null or ${t.unitId} is not null`),
    check('tenant_members_manager_has_unit', sql`not ${t.isManager} or ${t.unitId} is not null`),
  ],
);
