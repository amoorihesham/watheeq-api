import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    // Mapped to 409 SLUG_TAKEN in src/http/errors.ts.
    slug: text().notNull().unique(),
    // Nullable only while the tenant is being created; the owner can never be deleted or deactivated (Phase 0 spec, P0.10).
    ownerId: uuid("owner_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "tenants_name_length",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 100`,
    ),
    check("tenants_slug_format", sql`${t.slug} ~ '^[a-z0-9-]{2,50}$'`),
  ],
);
