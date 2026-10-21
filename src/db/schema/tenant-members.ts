import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orgUnits } from "./org-units.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Replaced by a role_id referencing tenant-defined roles in Phase 3 (Phase 0 spec, P0.13).
export const tenantMemberRoles = pgEnum("tenant_member_roles", ["admin", "member"]);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: tenantMemberRoles().notNull().default("member"),
    // Null: directly under the organization (Phase 2 spec, P2.13).
    unitId: uuid("unit_id"),
    // Managers are members of the unit they manage, so the flag lives on the membership (Phase 2 spec, P2.3).
    isManager: boolean("is_manager").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    // One membership per user: a user belongs to exactly one tenant (T5).
    uniqueIndex("tenant_members_user_unique").on(t.userId),
    // Includes tenant_id, so a member can only be placed in a unit of their own tenant (P2.2).
    foreignKey({
      name: "tenant_members_unit_fk",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    index("tenant_members_unit_idx").on(t.tenantId, t.unitId),
    check("tenant_members_manager_has_unit", sql`not ${t.isManager} or ${t.unitId} is not null`),
  ],
);
