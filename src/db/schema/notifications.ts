import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  type PgTableExtraConfigValue,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { requests } from "./requests.js";
import { tenantMembers } from "./tenant-members.js";
import { tenants } from "./tenants.js";

/** Escalation, lifecycle, subscription, and storage notifications (Phase 7 spec, 4.1 and 4.3). */
export const notificationKinds = pgEnum("notification_kinds", [
  "request.review_overdue",
  "request.at_risk",
  "request.breached",
  "escalation.no_recipients",
  "request.stage_assigned",
  "request.stage_held",
  "request.information_requested",
  "request.information_cancelled",
  "request.information_answered",
  "request.accepted",
  "request.handler_assigned",
  "request.handler_removed",
  "request.rejected",
  "request.completed",
  "request.closed_no_response",
  "request.priority_changed",
  "subscription.ending_soon",
  "subscription.grace_started",
  "subscription.read_only_started",
  "storage.nearly_full",
]);

/** One row per recipient: read state belongs to each of them (Phase 7 spec, 4.1). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id").notNull(),
    kind: notificationKinds().notNull(),
    // Null for subscription and storage kinds.
    requestId: uuid("request_id"),
    // The values the client words the notification from (T11); always `{number, title}` for request kinds.
    data: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notifications_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    foreignKey({
      name: "notifications_request_fk",
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    check("notifications_data_object", sql`jsonb_typeof(${t.data}) = 'object'`),
    index("notifications_list_idx").on(
      t.tenantId,
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("notifications_unread_idx").on(t.tenantId, t.userId).where(sql`${t.readAt} is null`),
    index("notifications_cleanup_idx").on(t.readAt).where(sql`${t.readAt} is not null`),
  ],
);
