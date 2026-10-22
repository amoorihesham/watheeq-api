import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const permissionScopes = pgEnum("permission_scopes", [
  "own",
  "section",
  "department",
  "organization",
]);

/** Tenant-defined roles; the permission catalog itself lives in code (Phase 3 spec, P3.1). */
export const roles = pgTable(
  "roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    // The Tenant Admin role: holds the whole catalog, computed, so it has no role_permissions rows (P3.8).
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("roles_tenant_id_unique").on(t.tenantId, t.id),
    check(
      "roles_name_length",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`,
    ),
    uniqueIndex("roles_name_unique").on(t.tenantId, sql`lower(${t.name})`),
    uniqueIndex("roles_system_unique").on(t.tenantId).where(sql`${t.isSystem}`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: uuid("tenant_id").notNull(),
    roleId: uuid("role_id").notNull(),
    // A catalog key, checked by the service; the format check is a second safeguard.
    permission: text().notNull(),
    scope: permissionScopes().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    foreignKey({
      name: "role_permissions_role_fk",
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete("cascade"),
    check("role_permissions_key_format", sql`${t.permission} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);
