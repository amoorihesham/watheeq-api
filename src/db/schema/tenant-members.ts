import { pgEnum, pgTable, primaryKey, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    // One membership per user: a user belongs to exactly one tenant (T5).
    uniqueIndex("tenant_members_user_unique").on(t.userId),
  ],
);
