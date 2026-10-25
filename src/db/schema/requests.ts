import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  type PgTableExtraConfigValue,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnswerSnapshotType } from "@/modules/services/shared/answers.js";
import { orgUnits } from "./org-units.js";
import { priorities } from "./priorities.js";
import { services } from "./services.js";
import { tenantMembers } from "./tenant-members.js";
import { tenants } from "./tenants.js";
import { workflowVersions } from "./workflows.js";

/** One counter row per tenant, prefix, and year; a row, not a sequence, so a rollback leaves no gap (Phase 6 spec, P6.1). */
export const numberSequences = pgTable(
  "number_sequences",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    prefix: text().notNull(),
    year: smallint().notNull(),
    lastValue: integer("last_value").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: "number_sequences_pk", columns: [t.tenantId, t.prefix, t.year] }),
    // A later record type (INV, CAS, MAT) is a new allowed value, not a new table.
    check("number_sequences_prefix", sql`${t.prefix} in ('REQ')`),
    check("number_sequences_last_value", sql`${t.lastValue} >= 1`),
  ],
);

export const requestStates = pgEnum("request_states", [
  "in_review",
  "in_progress",
  "completed",
  "rejected",
  "rejected_no_response",
  "withdrawn",
]);

/** A legal request from submission to closure (Phase 6 spec, 4.1). */
export const requests = pgTable(
  "requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    year: smallint().notNull(),
    number: integer().notNull(),
    state: requestStates().notNull(),
    title: text().notNull(),
    serviceId: uuid("service_id").notNull(),
    serviceName: text("service_name").notNull(),
    formRevision: integer("form_revision").notNull(),
    answers: jsonb().$type<AnswerSnapshotType[]>().notNull(),
    requesterId: uuid("requester_id").notNull(),
    // Recorded when set, so an old request stays with the unit it came from (Q4). Cleared with the unit, by the
    // custom migration that gives these keys `on delete set null (column)`, which Drizzle cannot declare.
    requesterUnitId: uuid("requester_unit_id"),
    priorityId: uuid("priority_id").notNull(),
    priorityName: text("priority_name").notNull(),
    priorityDays: smallint("priority_days").notNull(),
    handlerId: uuid("handler_id"),
    handlerUnitId: uuid("handler_unit_id"),
    workflowId: uuid("workflow_id"),
    workflowVersionId: uuid("workflow_version_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    closeReason: text("close_reason"),
    // The closure record, frozen at closure; null while open (Q6).
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    elapsedDays: numeric("elapsed_days", { precision: 12, scale: 6, mode: "number" }),
    breachDays: numeric("breach_days", { precision: 12, scale: 6, mode: "number" }),
    awaitingInfoDays: numeric("awaiting_info_days", { precision: 12, scale: 6, mode: "number" }),
    slaMet: boolean("sla_met"),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("requests_number_unique").on(t.tenantId, t.year, t.number),
    // The targets of the stage, information request, and file keys.
    unique("requests_tenant_id_unique").on(t.tenantId, t.id),
    unique("requests_tenant_id_version_unique").on(t.tenantId, t.id, t.workflowVersionId),
    foreignKey({
      name: "requests_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [services.tenantId, services.id],
    }),
    foreignKey({
      name: "requests_requester_fk",
      columns: [t.tenantId, t.requesterId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    foreignKey({
      name: "requests_requester_unit_fk",
      columns: [t.tenantId, t.requesterUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    foreignKey({
      name: "requests_priority_fk",
      columns: [t.tenantId, t.priorityId],
      foreignColumns: [priorities.tenantId, priorities.id],
    }),
    foreignKey({
      name: "requests_handler_fk",
      columns: [t.tenantId, t.handlerId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    foreignKey({
      name: "requests_handler_unit_fk",
      columns: [t.tenantId, t.handlerUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    foreignKey({
      name: "requests_workflow_version_fk",
      columns: [t.tenantId, t.workflowId, t.workflowVersionId],
      foreignColumns: [workflowVersions.tenantId, workflowVersions.workflowId, workflowVersions.id],
    }),
    foreignKey({
      name: "requests_accepted_by_fk",
      columns: [t.tenantId, t.acceptedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    foreignKey({
      name: "requests_closed_by_fk",
      columns: [t.tenantId, t.closedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    index("requests_state_idx").on(t.tenantId, t.state),
    index("requests_requester_idx").on(t.tenantId, t.requesterId),
    index("requests_handler_idx").on(t.tenantId, t.handlerId),
    index("requests_requester_unit_idx").on(t.tenantId, t.requesterUnitId),
    index("requests_handler_unit_idx").on(t.tenantId, t.handlerUnitId),
    check(
      "requests_title_length",
      sql`${t.title} = btrim(${t.title}) and char_length(${t.title}) between 1 and 200`,
    ),
    check("requests_answers_is_array", sql`jsonb_typeof(${t.answers}) = 'array'`),
    // Accepted requests have a handler, a workflow version, and an acceptance; the others have none of them.
    check(
      "requests_accepted_columns",
      sql`(${t.state} in ('in_progress', 'completed', 'rejected_no_response')) = (
        ${t.handlerId} is not null and ${t.workflowId} is not null and ${t.workflowVersionId} is not null
        and ${t.acceptedAt} is not null and ${t.acceptedBy} is not null
      )`,
    ),
    check(
      "requests_not_accepted_columns",
      sql`${t.state} in ('in_progress', 'completed', 'rejected_no_response') or (
        ${t.handlerId} is null and ${t.workflowId} is null and ${t.workflowVersionId} is null
        and ${t.handlerUnitId} is null and ${t.acceptedAt} is null and ${t.acceptedBy} is null
      )`,
    ),
    check(
      "requests_closed_columns",
      sql`(${t.state} not in ('in_review', 'in_progress')) = (${t.closedAt} is not null and ${t.closedBy} is not null)`,
    ),
    // A reason is required for every closure except completion.
    check(
      "requests_close_reason",
      sql`(${t.state} in ('rejected', 'withdrawn', 'rejected_no_response')) = (${t.closeReason} is not null)`,
    ),
    // The closure record exists exactly for requests that were accepted and closed.
    check(
      "requests_sla_record",
      sql`(${t.state} in ('completed', 'rejected_no_response')) = (
        ${t.slaDeadline} is not null and ${t.elapsedDays} is not null and ${t.breachDays} is not null
        and ${t.awaitingInfoDays} is not null and ${t.slaMet} is not null
      )`,
    ),
    check(
      "requests_sla_record_absent",
      sql`${t.state} in ('completed', 'rejected_no_response') or (
        ${t.slaDeadline} is null and ${t.elapsedDays} is null and ${t.breachDays} is null
        and ${t.awaitingInfoDays} is null and ${t.slaMet} is null
      )`,
    ),
  ],
);
