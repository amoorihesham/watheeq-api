import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  type PgTableExtraConfigValue,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { requests } from "./requests.js";
import { tenantMembers } from "./tenant-members.js";
import { tenants } from "./tenants.js";

/** `closed` marks a question still open when its request closed (Phase 6 spec, 4.1). */
export const informationRequestStates = pgEnum("information_request_states", [
  "open",
  "answered",
  "cancelled",
  "closed",
]);

export const informationAskedIn = pgEnum("information_asked_in", ["review", "execution"]);

/** A question from legal to the requester; at most one is open per request (Phase 6 spec, 4.1). */
export const informationRequests = pgTable(
  "information_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requestId: uuid("request_id").notNull(),
    askedBy: uuid("asked_by").notNull(),
    askedIn: informationAskedIn("asked_in").notNull(),
    question: text().notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    state: informationRequestStates().notNull().default("open"),
    answer: text(),
    // When it was answered, cancelled, or closed with its request, and by whom.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by"),
  },
  (t): PgTableExtraConfigValue[] => [
    // The target of the answer files' key, so a file cannot name another request's question.
    unique("information_requests_request_id_unique").on(t.tenantId, t.requestId, t.id),
    foreignKey({
      name: "information_requests_request_fk",
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({
      name: "information_requests_asked_by_fk",
      columns: [t.tenantId, t.askedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    foreignKey({
      name: "information_requests_ended_by_fk",
      columns: [t.tenantId, t.endedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    // One open question per request, whatever the application checks.
    uniqueIndex("information_requests_one_open").on(t.requestId).where(sql`${t.state} = 'open'`),
    index("information_requests_request_idx").on(t.requestId),
    check(
      "information_requests_question_length",
      sql`char_length(${t.question}) between 1 and 4000`,
    ),
    check(
      "information_requests_answer_length",
      sql`${t.answer} is null or char_length(${t.answer}) between 1 and 10000`,
    ),
    check(
      "information_requests_answered",
      sql`(${t.state} = 'answered') = (${t.answer} is not null)`,
    ),
    check(
      "information_requests_ended",
      sql`(${t.state} <> 'open') = (${t.endedAt} is not null and ${t.endedBy} is not null)`,
    ),
  ],
);
