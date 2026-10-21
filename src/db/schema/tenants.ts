import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const tenants = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  // Nullable only while the tenant is being created; the owner can never be deleted or deactivated (Phase 0 spec, P0.10).
  ownerId: uuid("owner_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
