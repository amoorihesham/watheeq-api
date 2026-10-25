import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { dateFromEpochMs } from "@/db/rows.js";
import {
  files,
  informationRequests,
  priorities,
  requestFiles,
  requestStageAssignees,
  requestStageRuns,
  requests,
  services,
  serviceWorkflows,
  tenantMembers,
  users,
  workflowStages,
  workflows,
} from "@/db/schema/index.js";
import type {
  InformationRequestListRowType,
  InformationRequestRowType,
  ListRequestsQueryType,
  MemberUnitRowType,
  NewInformationRequestType,
  NewRequestFileType,
  PriorityRowType,
  RequestDetailRowType,
  RequestFileRowType,
  RequestRowType,
  RequestSummaryRowType,
  RequestViewType,
  ServiceRowType,
  StageAssigneeRowType,
  StageDefRowType,
  StageRunRowType,
  StageRunViewRowType,
  WorkflowRowType,
} from "./requests.types.js";
import { reviewableBy, waitingOnMe } from "./shared/visibility.js";

const handlerUser = alias(users, "handler_user");

const { answers: _answers, ...summaryOwnColumns } = getTableColumns(requests);
const summaryColumns = {
  ...summaryOwnColumns,
  requesterName: users.userName,
  handlerName: handlerUser.userName,
};

const attacher = alias(users, "attacher");
const asker = alias(users, "asker");
const ender = alias(users, "ender");

const fileColumns = {
  id: files.id,
  name: files.name,
  // A file is never linked to a request before it has a detected type.
  contentType: sql<string>`${files.contentType}`,
  sizeBytes: files.sizeBytes,
  sha256: sql<string>`${files.sha256}`,
  fieldId: requestFiles.fieldId,
  informationRequestId: requestFiles.informationRequestId,
  attachedBy: requestFiles.attachedBy,
  attachedByName: attacher.userName,
  attachedAt: requestFiles.attachedAt,
};

const ofTenant = (tenantId: string, requestId: string) =>
  and(eq(requests.tenantId, tenantId), eq(requests.id, requestId));

/** The state change that closes a request, with the closure record of an accepted one (Phase 6 spec, 4.3). */
export interface ClosureType {
  closedAt: Date;
  state: "completed" | "rejected" | "rejected_no_response" | "withdrawn";
  closedBy: string;
  closeReason: string | null;
  record: {
    deadline: Date;
    elapsedDays: number;
    breachDays: number;
    awaitingInfoDays: number;
    met: boolean;
  } | null;
}

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createRequestsRepository() {
  const selectSummaries = (db: Executor) =>
    db
      .select(summaryColumns)
      .from(requests)
      .innerJoin(users, eq(users.id, requests.requesterId))
      .leftJoin(handlerUser, eq(handlerUser.id, requests.handlerId));

  function viewFilter(view: RequestViewType, tenantId: string, callerId: string): SQL {
    switch (view) {
      case "waiting_on_me":
        return waitingOnMe(tenantId, callerId);
      case "handling":
        return eq(requests.handlerId, callerId);
      case "requested":
        return eq(requests.requesterId, callerId);
      case "review_queue":
        return reviewableBy(tenantId, callerId);
    }
  }

  function listFilter(
    tenantId: string,
    callerId: string,
    query: ListRequestsQueryType,
    visible: SQL,
  ): SQL | undefined {
    return and(
      eq(requests.tenantId, tenantId),
      visible,
      query.view ? viewFilter(query.view, tenantId, callerId) : undefined,
      query.state ? eq(requests.state, query.state) : undefined,
      query.serviceId ? eq(requests.serviceId, query.serviceId) : undefined,
    );
  }

  return {
    /** The database clock, in the transaction's own time, so a closure and its audit entry agree. */
    async now(db: Executor): Promise<Date> {
      const { rows } = await db.execute<{ ms: number }>(
        sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
      );
      return dateFromEpochMs(rows[0]?.ms ?? 0);
    },

    list(
      db: Executor,
      tenantId: string,
      callerId: string,
      query: ListRequestsQueryType,
      visible: SQL,
    ): Promise<RequestSummaryRowType[]> {
      return selectSummaries(db)
        .where(listFilter(tenantId, callerId, query, visible))
        .orderBy(desc(requests.submittedAt), requests.id)
        .limit(query.limit)
        .offset(query.offset);
    },

    count(
      db: Executor,
      tenantId: string,
      callerId: string,
      query: ListRequestsQueryType,
      visible: SQL,
    ): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(requests)
        .where(listFilter(tenantId, callerId, query, visible));
    },

    /** `visible` limits the lookup to requests the caller may see (R6.7). */
    findById(
      db: Executor,
      tenantId: string,
      requestId: string,
      visible?: SQL,
    ): Promise<RequestDetailRowType[]> {
      return db
        .select({ ...summaryColumns, answers: requests.answers })
        .from(requests)
        .innerJoin(users, eq(users.id, requests.requesterId))
        .leftJoin(handlerUser, eq(handlerUser.id, requests.handlerId))
        .where(and(ofTenant(tenantId, requestId), visible));
    },

    /**
     * Locks a visible request before any check of its state, so two actions on one request run one after the
     * other and the second sees the first's result (P6.8).
     */
    lockVisible(
      db: Executor,
      tenantId: string,
      requestId: string,
      visible: SQL,
    ): Promise<RequestRowType[]> {
      return db
        .select()
        .from(requests)
        .where(and(ofTenant(tenantId, requestId), visible))
        .for("update", { of: requests });
    },

    insert(db: Executor, values: typeof requests.$inferInsert): Promise<RequestRowType[]> {
      return db.insert(requests).values(values).returning();
    },

    update(
      db: Executor,
      tenantId: string,
      requestId: string,
      patch: Partial<typeof requests.$inferInsert>,
    ): Promise<RequestRowType[]> {
      return db.update(requests).set(patch).where(ofTenant(tenantId, requestId)).returning();
    },

    /** Sets the closing state and moment and the closure record. */
    close(db: Executor, tenantId: string, requestId: string, closure: ClosureType) {
      const { record } = closure;
      return db
        .update(requests)
        .set({
          state: closure.state,
          closedAt: closure.closedAt,
          closedBy: closure.closedBy,
          closeReason: closure.closeReason,
          slaDeadline: record?.deadline ?? null,
          elapsedDays: record?.elapsedDays ?? null,
          breachDays: record?.breachDays ?? null,
          awaitingInfoDays: record?.awaitingInfoDays ?? null,
          slaMet: record?.met ?? null,
        })
        .where(ofTenant(tenantId, requestId));
    },

    /** Whether the user is an active member of the tenant now: a token may outlive a deactivation. */
    isActiveMember(db: Executor, tenantId: string, userId: string): Promise<{ id: string }[]> {
      return db
        .select({ id: users.id })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, userId),
            eq(users.isActive, true),
          ),
        );
    },

    countFiles(db: Executor, tenantId: string, requestId: string): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(requestFiles)
        .where(and(eq(requestFiles.tenantId, tenantId), eq(requestFiles.requestId, requestId)));
    },

    insertFiles(db: Executor, rows: NewRequestFileType[]) {
      return db.insert(requestFiles).values(rows);
    },

    filesOf(db: Executor, tenantId: string, requestId: string): Promise<RequestFileRowType[]> {
      return db
        .select(fileColumns)
        .from(requestFiles)
        .innerJoin(
          files,
          and(eq(files.tenantId, requestFiles.tenantId), eq(files.id, requestFiles.fileId)),
        )
        .innerJoin(attacher, eq(attacher.id, requestFiles.attachedBy))
        .where(and(eq(requestFiles.tenantId, tenantId), eq(requestFiles.requestId, requestId)))
        .orderBy(asc(requestFiles.attachedAt), asc(files.name), asc(files.id));
    },

    /** One of the request's attached files; none for a file of another request, or one already removed. */
    findFile(
      db: Executor,
      tenantId: string,
      requestId: string,
      fileId: string,
    ): Promise<RequestFileRowType[]> {
      return db
        .select(fileColumns)
        .from(requestFiles)
        .innerJoin(
          files,
          and(eq(files.tenantId, requestFiles.tenantId), eq(files.id, requestFiles.fileId)),
        )
        .innerJoin(attacher, eq(attacher.id, requestFiles.attachedBy))
        .where(
          and(
            eq(requestFiles.tenantId, tenantId),
            eq(requestFiles.requestId, requestId),
            eq(requestFiles.fileId, fileId),
          ),
        );
    },

    /** The request's open question, if any. */
    openInformation(
      db: Executor,
      tenantId: string,
      requestId: string,
    ): Promise<InformationRequestRowType[]> {
      return db
        .select()
        .from(informationRequests)
        .where(
          and(
            eq(informationRequests.tenantId, tenantId),
            eq(informationRequests.requestId, requestId),
            eq(informationRequests.state, "open"),
          ),
        );
    },

    insertInformation(
      db: Executor,
      values: NewInformationRequestType,
    ): Promise<InformationRequestRowType[]> {
      return db.insert(informationRequests).values(values).returning();
    },

    /** One of the request's questions; none for another request's. */
    findInformation(
      db: Executor,
      tenantId: string,
      requestId: string,
      informationId: string,
    ): Promise<InformationRequestRowType[]> {
      return db
        .select()
        .from(informationRequests)
        .where(
          and(
            eq(informationRequests.tenantId, tenantId),
            eq(informationRequests.requestId, requestId),
            eq(informationRequests.id, informationId),
          ),
        );
    },

    endInformation(
      db: Executor,
      tenantId: string,
      informationId: string,
      patch: {
        state: "answered" | "cancelled";
        answer?: string;
        endedAt: Date;
        endedBy: string;
      },
    ) {
      return db
        .update(informationRequests)
        .set(patch)
        .where(
          and(
            eq(informationRequests.tenantId, tenantId),
            eq(informationRequests.id, informationId),
          ),
        );
    },

    /** Marks a question that is still open as `closed`, because its request closed. */
    closeOpenInformation(
      db: Executor,
      tenantId: string,
      requestId: string,
      endedAt: Date,
      endedBy: string,
    ) {
      return db
        .update(informationRequests)
        .set({ state: "closed", endedAt, endedBy })
        .where(
          and(
            eq(informationRequests.tenantId, tenantId),
            eq(informationRequests.requestId, requestId),
            eq(informationRequests.state, "open"),
          ),
        );
    },

    informationOf(
      db: Executor,
      tenantId: string,
      requestId: string,
    ): Promise<InformationRequestListRowType[]> {
      return db
        .select({
          ...getTableColumns(informationRequests),
          askedByName: asker.userName,
          endedByName: ender.userName,
        })
        .from(informationRequests)
        .innerJoin(asker, eq(asker.id, informationRequests.askedBy))
        .leftJoin(ender, eq(ender.id, informationRequests.endedBy))
        .where(
          and(
            eq(informationRequests.tenantId, tenantId),
            eq(informationRequests.requestId, requestId),
          ),
        )
        .orderBy(asc(informationRequests.askedAt), asc(informationRequests.id));
    },

    deleteFileLink(db: Executor, tenantId: string, fileId: string) {
      return db
        .delete(requestFiles)
        .where(and(eq(requestFiles.tenantId, tenantId), eq(requestFiles.fileId, fileId)));
    },

    /** The member's unit now; no row for a user outside the tenant. */
    memberUnit(db: Executor, tenantId: string, userId: string): Promise<MemberUnitRowType[]> {
      return db
        .select({ unitId: tenantMembers.unitId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },

    /** The service, locked against retiring until the transaction ends (T36). */
    lockService(db: Executor, tenantId: string, serviceId: string): Promise<ServiceRowType[]> {
      return db
        .select({
          id: services.id,
          name: services.name,
          description: services.description,
          retiredAt: services.retiredAt,
          form: services.form,
          formRevision: services.formRevision,
        })
        .from(services)
        .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId)))
        .for("share");
    },

    lockPriority(db: Executor, tenantId: string, priorityId: string): Promise<PriorityRowType[]> {
      return db
        .select({
          id: priorities.id,
          name: priorities.name,
          days: priorities.days,
          retiredAt: priorities.retiredAt,
        })
        .from(priorities)
        .where(and(eq(priorities.tenantId, tenantId), eq(priorities.id, priorityId)))
        .for("share");
    },

    lockWorkflow(db: Executor, tenantId: string, workflowId: string): Promise<WorkflowRowType[]> {
      return db
        .select({
          id: workflows.id,
          retiredAt: workflows.retiredAt,
          currentVersionId: workflows.currentVersionId,
        })
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), eq(workflows.id, workflowId)))
        .for("share");
    },

    /** Whether the service currently allows the workflow. */
    serviceAllows(
      db: Executor,
      tenantId: string,
      serviceId: string,
      workflowId: string,
    ): Promise<{ workflowId: string }[]> {
      return db
        .select({ workflowId: serviceWorkflows.workflowId })
        .from(serviceWorkflows)
        .where(
          and(
            eq(serviceWorkflows.tenantId, tenantId),
            eq(serviceWorkflows.serviceId, serviceId),
            eq(serviceWorkflows.workflowId, workflowId),
          ),
        );
    },

    /** The stages of one workflow version, in order. */
    stageDefs(db: Executor, tenantId: string, versionId: string): Promise<StageDefRowType[]> {
      return db
        .select({
          id: workflowStages.id,
          ordinal: workflowStages.ordinal,
          name: workflowStages.name,
          targetPositionId: workflowStages.targetPositionId,
          targetBuiltin: workflowStages.targetBuiltin,
          whenUnresolved: workflowStages.whenUnresolved,
          handlerMayNarrow: workflowStages.handlerMayNarrow,
          handlerMayEscalate: workflowStages.handlerMayEscalate,
          excludeParties: workflowStages.excludeParties,
        })
        .from(workflowStages)
        .where(and(eq(workflowStages.tenantId, tenantId), eq(workflowStages.versionId, versionId)))
        .orderBy(workflowStages.ordinal);
    },

    /** The request's live (active or held) run, if any. */
    liveRun(db: Executor, tenantId: string, requestId: string): Promise<StageRunRowType[]> {
      return db
        .select()
        .from(requestStageRuns)
        .where(
          and(
            eq(requestStageRuns.tenantId, tenantId),
            eq(requestStageRuns.requestId, requestId),
            inArray(requestStageRuns.state, ["active", "held"]),
          ),
        );
    },

    /** Every run of the requests, in the order they started, with the stage's name. */
    runsOf(
      db: Executor,
      tenantId: string,
      requestIds: string[],
      liveOnly = false,
    ): Promise<StageRunViewRowType[]> {
      if (requestIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({
          ...getTableColumns(requestStageRuns),
          stageName: workflowStages.name,
          endedByName: users.userName,
        })
        .from(requestStageRuns)
        .innerJoin(
          workflowStages,
          and(
            eq(workflowStages.tenantId, requestStageRuns.tenantId),
            eq(workflowStages.id, requestStageRuns.workflowStageId),
          ),
        )
        .leftJoin(users, eq(users.id, requestStageRuns.endedBy))
        .where(
          and(
            eq(requestStageRuns.tenantId, tenantId),
            inArray(requestStageRuns.requestId, requestIds),
            liveOnly ? inArray(requestStageRuns.state, ["active", "held"]) : undefined,
          ),
        )
        .orderBy(requestStageRuns.startedAt, requestStageRuns.ordinal);
    },

    assigneesOf(db: Executor, tenantId: string, runIds: string[]): Promise<StageAssigneeRowType[]> {
      if (runIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({
          runId: requestStageAssignees.runId,
          userId: requestStageAssignees.userId,
          name: users.userName,
        })
        .from(requestStageAssignees)
        .innerJoin(users, eq(users.id, requestStageAssignees.userId))
        .where(
          and(
            eq(requestStageAssignees.tenantId, tenantId),
            inArray(requestStageAssignees.runId, runIds),
          ),
        )
        .orderBy(byName(users.userName), users.id);
    },

    insertRun(
      db: Executor,
      values: typeof requestStageRuns.$inferInsert,
    ): Promise<StageRunRowType[]> {
      return db.insert(requestStageRuns).values(values).returning();
    },

    updateRun(
      db: Executor,
      tenantId: string,
      runId: string,
      patch: Partial<typeof requestStageRuns.$inferInsert>,
    ) {
      return db
        .update(requestStageRuns)
        .set(patch)
        .where(and(eq(requestStageRuns.tenantId, tenantId), eq(requestStageRuns.id, runId)));
    },

    async replaceAssignees(db: Executor, tenantId: string, runId: string, userIds: string[]) {
      await db
        .delete(requestStageAssignees)
        .where(
          and(eq(requestStageAssignees.tenantId, tenantId), eq(requestStageAssignees.runId, runId)),
        );
      if (userIds.length > 0) {
        await db
          .insert(requestStageAssignees)
          .values(userIds.map((userId) => ({ tenantId, runId, userId })));
      }
    },

    /** The nearest earlier stage that ran to completion: skipped and returned runs are passed over (Q18). */
    latestCompletedBefore(
      db: Executor,
      tenantId: string,
      requestId: string,
      ordinal: number,
    ): Promise<StageRunRowType[]> {
      return db
        .select()
        .from(requestStageRuns)
        .where(
          and(
            eq(requestStageRuns.tenantId, tenantId),
            eq(requestStageRuns.requestId, requestId),
            eq(requestStageRuns.state, "completed"),
            lt(requestStageRuns.ordinal, ordinal),
          ),
        )
        .orderBy(desc(requestStageRuns.ordinal), desc(requestStageRuns.startedAt))
        .limit(1);
    },

    /** Ends the live run, if there is one, because the request closed. */
    cancelLiveRun(
      db: Executor,
      tenantId: string,
      requestId: string,
      endedAt: Date,
      endedBy: string,
    ) {
      return db
        .update(requestStageRuns)
        .set({ state: "cancelled", endedAt, endedBy })
        .where(
          and(
            eq(requestStageRuns.tenantId, tenantId),
            eq(requestStageRuns.requestId, requestId),
            inArray(requestStageRuns.state, ["active", "held"]),
          ),
        );
    },

    activeServices(db: Executor, tenantId: string): Promise<ServiceRowType[]> {
      return db
        .select({
          id: services.id,
          name: services.name,
          description: services.description,
          retiredAt: services.retiredAt,
          form: services.form,
          formRevision: services.formRevision,
        })
        .from(services)
        .where(and(eq(services.tenantId, tenantId), isNull(services.retiredAt)))
        .orderBy(byName(services.name), services.id);
    },

    activePriorities(db: Executor, tenantId: string): Promise<PriorityRowType[]> {
      return db
        .select({
          id: priorities.id,
          name: priorities.name,
          days: priorities.days,
          retiredAt: priorities.retiredAt,
        })
        .from(priorities)
        .where(and(eq(priorities.tenantId, tenantId), isNull(priorities.retiredAt)))
        .orderBy(priorities.sortOrder);
    },
  };
}
