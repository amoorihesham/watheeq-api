import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./bytea.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Tenant user login sessions. Tenant-owned, so protected by RLS (policies are hand-written).
 * Only SHA-256 hashes of the tokens are stored (decision P0.5).
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text(),
  },
  (t) => [
    uniqueIndex("user_sessions_token_hash_unique").on(t.tokenHash),
    // Every RLS check filters on tenant_id, and deactivating a user revokes by user.
    index("user_sessions_tenant_id_idx").on(t.tenantId),
    index("user_sessions_user_id_idx").on(t.userId),
  ],
);
