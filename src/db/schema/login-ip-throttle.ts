import { inet, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * Failed logins per client IP, shared by both realms. Platform security data, not tenant data: no RLS.
 * Rows of old windows are harmless: the next failure from that IP starts a new window.
 */
export const loginIpThrottle = pgTable("login_ip_throttle", {
  ip: inet().primaryKey(),
  failedCount: integer("failed_count").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
});
