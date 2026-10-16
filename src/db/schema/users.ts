import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // Lowercased and trimmed (enforced by users_email_normalized). Unique across the platform (T7).
    email: text().notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    // Every RLS check filters on tenant_id.
    index("users_tenant_id_idx").on(t.tenantId),
    // Without this, "Sara@AlNoor.com.sa" could be stored next to "sara@alnoor.com.sa" and slip past the unique index.
    check("users_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);
