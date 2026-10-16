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
import { bytea } from "./bytea.js";

/** Platform operators. Not tenant-owned, so no tenant_id and no RLS (decision P0.4). */
export const operators = pgTable(
  "operators",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Lowercased and trimmed, enforced by operators_email_normalized.
    email: text().notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("operators_email_unique").on(t.email),
    check("operators_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);

/** Operator login sessions. Only SHA-256 hashes of the tokens are stored (decision P0.5). */
export const operatorSessions = pgTable(
  "operator_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id),
    tokenHash: bytea("token_hash").notNull(),
    csrfTokenHash: bytea("csrf_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text(),
  },
  (t) => [
    uniqueIndex("operator_sessions_token_hash_unique").on(t.tokenHash),
    index("operator_sessions_operator_id_idx").on(t.operatorId),
  ],
);
