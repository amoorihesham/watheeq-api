import { and, count, desc, eq, getTableColumns, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { dateFromEpochMs } from "@/db/rows.js";
import {
  priorities,
  requests,
  services,
  serviceWorkflows,
  tenantMembers,
  users,
  workflows,
} from "@/db/schema/index.js";
import type {
  ListRequestsQueryType,
  MemberUnitRowType,
  PriorityRowType,
  RequestDetailRowType,
  RequestRowType,
  RequestSummaryRowType,
  RequestViewType,
  ServiceRowType,
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
    ) {
      return db.update(requests).set(patch).where(ofTenant(tenantId, requestId));
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
