import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  type PgTableExtraConfigValue,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AssigneeLevelType } from "@/modules/positions/index.js";
import { requests } from "./requests.js";
import { tenantMembers } from "./tenant-members.js";
import { tenants } from "./tenants.js";
import { workflowStages } from "./workflows.js";

/** `cancelled`: the request closed while the run was active or held (Phase 6 spec, 4.1). */
export const stageRunStates = pgEnum("stage_run_states", [
  "active",
  "held",
  "completed",
  "returned",
  "skipped",
  "cancelled",
]);

/** One start of one workflow stage on one request; returning to a stage starts a new run (P6.3). */
export const requestStageRuns = pgTable(
  "request_stage_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requestId: uuid("request_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    workflowStageId: uuid("workflow_stage_id").notNull(),
    ordinal: smallint().notNull(),
    state: stageRunStates().notNull(),
    // The resolver level the assignees came from; null while held.
    level: jsonb().$type<AssigneeLevelType>(),
    narrowed: boolean().notNull().default(false),
    escalated: boolean().notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by"),
    comment: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("request_stage_runs_tenant_id_unique").on(t.tenantId, t.id),
    foreignKey({
      name: "request_stage_runs_request_fk",
      columns: [t.tenantId, t.requestId, t.workflowVersionId],
      foreignColumns: [requests.tenantId, requests.id, requests.workflowVersionId],
    }),
    // A run always belongs to its request's own workflow version.
    foreignKey({
      name: "request_stage_runs_stage_fk",
      columns: [t.tenantId, t.workflowVersionId, t.workflowStageId],
      foreignColumns: [workflowStages.tenantId, workflowStages.versionId, workflowStages.id],
    }),
    foreignKey({
      name: "request_stage_runs_ended_by_fk",
      columns: [t.tenantId, t.endedBy],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    // One live run per request.
    uniqueIndex("request_stage_runs_live_unique")
      .on(t.requestId)
      .where(sql`${t.state} in ('active', 'held')`),
    index("request_stage_runs_request_idx").on(t.tenantId, t.requestId),
    check(
      "request_stage_runs_ended",
      sql`(${t.state} in ('active', 'held')) = (${t.endedAt} is null)`,
    ),
    check(
      "request_stage_runs_level",
      sql`(${t.state} <> 'active' or ${t.level} is not null) and (${t.state} <> 'held' or ${t.level} is null)`,
    ),
    check(
      "request_stage_runs_comment_length",
      sql`${t.comment} is null or char_length(${t.comment}) between 1 and 2000`,
    ),
  ],
);

/** Who a run waited on; the rows of ended runs are kept for the history (P6.3). */
export const requestStageAssignees = pgTable(
  "request_stage_assignees",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    runId: uuid("run_id").notNull(),
    userId: uuid("user_id").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: "request_stage_assignees_pk", columns: [t.runId, t.userId] }),
    foreignKey({
      name: "request_stage_assignees_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [requestStageRuns.tenantId, requestStageRuns.id],
    }),
    foreignKey({
      name: "request_stage_assignees_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    // "Waiting on me" is one indexed query.
    index("request_stage_assignees_user_idx").on(t.tenantId, t.userId),
  ],
);
