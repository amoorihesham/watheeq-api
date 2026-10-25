import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor, Tx } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import { loadCalendar } from "@/modules/calendar/index.js";
import { isEscalationConfigured } from "@/modules/escalation/index.js";
import { snapshotAnswers, validateAnswers } from "@/modules/services/index.js";
import {
  assertGrantsHeld,
  type GrantMapType,
  loadMemberGrants,
} from "@/modules/tenant-access/index.js";
import { NUMBER_PREFIX } from "./requests.config.js";
import {
  acceptRequestSchema,
  changePriorityRequestSchema,
  listRequestsQuerySchema,
  reasonRequestSchema,
  requestIdSchema,
  submitRequestSchema,
} from "./requests.schemas.js";
import type {
  AcceptRequestType,
  CatalogType,
  ChangePriorityRequestType,
  ListRequestsResponseType,
  ReasonRequestType,
  RequestDetailRowType,
  RequestRowType,
  RequestSummaryRowType,
  RequestSummaryType,
  RequestsRepositoryType,
  RequestType,
  SubmitRequestType,
} from "./requests.types.js";
import { nextNumber } from "./shared/numbers.js";
import { closeRequest, frozenSlaOf, slaOf } from "./shared/sla.js";
import { visibleRequests } from "./shared/visibility.js";

const REVIEW = [{ key: "request.review", scope: "organization" }] as const;

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingRequestId(requestId: string): string {
  if (!requestIdSchema.safeParse(requestId).success) {
    throw new AppError("NOT_FOUND");
  }
  return requestId;
}

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

function assertState(request: RequestRowType, state: RequestRowType["state"]): void {
  if (request.state !== state) {
    throw new AppError("INVALID_REQUEST_STATE");
  }
}

const numberOf = (row: Pick<RequestRowType, "number" | "year">) => `REQ-${row.number}-${row.year}`;

/** The live deadline of a request in progress, the frozen one of a closed request, otherwise none. */
const deadlineOf = (
  row: RequestSummaryRowType,
  calendar: Awaited<ReturnType<typeof loadCalendar>> | null,
): Date | null =>
  row.state === "in_progress" && calendar
    ? (slaOf(row, calendar)?.deadline ?? null)
    : (frozenSlaOf(row)?.deadline ?? null);

function toSummary(
  row: RequestSummaryRowType,
  calendar: Awaited<ReturnType<typeof loadCalendar>> | null,
): RequestSummaryType {
  return {
    id: row.id,
    number: numberOf(row),
    title: row.title,
    state: row.state,
    service: { id: row.serviceId, name: row.serviceName },
    priority: { name: row.priorityName, days: row.priorityDays },
    requester: { id: row.requesterId, name: row.requesterName },
    handler: row.handlerId && row.handlerName ? { id: row.handlerId, name: row.handlerName } : null,
    submittedAt: row.submittedAt,
    acceptedAt: row.acceptedAt,
    closedAt: row.closedAt,
    deadline: deadlineOf(row, calendar),
    activeStage: null,
  };
}

/** What the caller may do with the request now, so the web app shows only valid buttons (4.2). */
function allowedActionsOf(row: RequestSummaryRowType, callerId: string, grants: GrantMapType) {
  const actions: string[] = [];
  if (row.state === "in_review") {
    if (row.requesterId === callerId) {
      actions.push("withdraw");
    }
    if (grants.has("request.review")) {
      actions.push("change_priority", "accept", "reject");
    }
  }
  if (row.state === "in_progress" && grants.has("request.reassign")) {
    actions.push("reassign");
  }
  return actions;
}

export function createRequestsService({ db, repo }: { db: Db; repo: RequestsRepositoryType }) {
  /** The request page for a caller who is already known to see it. */
  async function toRequest(
    executor: Executor,
    row: RequestDetailRowType,
    callerId: string,
  ): Promise<RequestType> {
    const calendar =
      row.state === "in_progress" ? await loadCalendar(executor, row.tenantId) : null;
    const grants = await loadMemberGrants(executor, row.tenantId, callerId);
    return {
      ...toSummary(row, calendar),
      answers: row.answers,
      files: [],
      stages: [],
      informationRequests: [],
      sla: calendar ? slaOf(row, calendar) : frozenSlaOf(row),
      allowedActions: allowedActionsOf(row, callerId, grants),
    };
  }

  /** Reads the request after an action, without the visibility filter: the action has just authorized the caller. */
  async function reload(
    executor: Executor,
    tenantId: string,
    requestId: string,
    callerId: string,
  ): Promise<RequestType> {
    const [row] = await repo.findById(executor, tenantId, requestId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return toRequest(executor, row, callerId);
  }

  /** Locks the request if the caller sees it; anything else is 404 (R6.7, P6.8). */
  async function lockRequest(
    tx: Tx,
    tenantId: string,
    callerId: string,
    requestId: string,
  ): Promise<RequestRowType> {
    const [row] = await repo.lockVisible(
      tx,
      tenantId,
      requestId,
      visibleRequests(tenantId, callerId),
    );
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  /**
   * The handler's unit, after checking that the person may be the handler (R6.11): an active member who holds
   * `request.handle` by their role as it is now, and who is not the requester.
   */
  async function handlerUnitOf(
    tx: Tx,
    tenantId: string,
    requesterId: string,
    handlerId: string,
  ): Promise<string | null> {
    if (handlerId === requesterId) {
      throw invalid("handlerId", "handler_is_requester");
    }
    if (!(await loadMemberGrants(tx, tenantId, handlerId)).has("request.handle")) {
      throw invalid("handlerId", "handler_not_eligible");
    }
    const [member] = await repo.memberUnit(tx, tenantId, handlerId);
    return member?.unitId ?? null;
  }

  return {
    /** The active services with their forms and the active priorities (R6.2). */
    async catalog(tenantId: string): Promise<CatalogType> {
      const [services, priorities] = await Promise.all([
        repo.activeServices(db, tenantId),
        repo.activePriorities(db, tenantId),
      ]);
      return {
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          form: { revision: service.formRevision, fields: service.form },
        })),
        priorities: priorities.map(({ id, name, days }) => ({ id, name, days })),
      };
    },

    /** Submission (R6.3-R6.5): one transaction from the shared locks to the audit entry. */
    submit(
      tenantId: string,
      callerId: string,
      input: SubmitRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const body = validate(submitRequestSchema, input);
      return withTx(db, async (tx) => {
        if (!(await isEscalationConfigured(tx, tenantId))) {
          throw new AppError("ESCALATION_NOT_CONFIGURED");
        }
        const [service] = await repo.lockService(tx, tenantId, body.serviceId);
        const [priority] = await repo.lockPriority(tx, tenantId, body.priorityId);
        const problems: ErrorDetail[] = [];
        if (!service) {
          problems.push({ path: "serviceId", code: "unknown_service" });
        } else if (service.retiredAt) {
          problems.push({ path: "serviceId", code: "service_retired" });
        }
        if (!priority) {
          problems.push({ path: "priorityId", code: "unknown_priority" });
        } else if (priority.retiredAt) {
          problems.push({ path: "priorityId", code: "priority_retired" });
        }
        if (!service || !priority || problems.length > 0) {
          throw new AppError("VALIDATION_FAILED", problems);
        }
        const answerProblems = validateAnswers(service.form, body.answers);
        if (answerProblems.length > 0) {
          throw new AppError("VALIDATION_FAILED", answerProblems);
        }

        const { year, number } = await nextNumber(tx, tenantId, NUMBER_PREFIX);
        const [member] = await repo.memberUnit(tx, tenantId, callerId);
        const [created] = await repo.insert(tx, {
          tenantId,
          year,
          number,
          state: "in_review",
          title: body.title,
          serviceId: service.id,
          serviceName: service.name,
          formRevision: service.formRevision,
          answers: snapshotAnswers(service.form, body.answers),
          requesterId: callerId,
          requesterUnitId: member?.unitId ?? null,
          priorityId: priority.id,
          priorityName: priority.name,
          priorityDays: priority.days,
        });
        if (!created) {
          throw new Error("the request insert returned no row");
        }
        // Step 6.4 attaches the form's files and `fileIds` here, and adds their IDs to the audit entry.
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.submitted",
          resourceType: "request",
          resourceId: created.id,
          details: {
            number: numberOf(created),
            service: { id: service.id, name: service.name },
            priority: { id: priority.id, name: priority.name, days: priority.days },
            title: body.title,
          },
        });
        return reload(tx, tenantId, created.id, callerId);
      });
    },

    /** The requests the caller sees, optionally narrowed by a view, state, and service (R6.7, R6.8). */
    async list(
      tenantId: string,
      callerId: string,
      input: unknown,
    ): Promise<ListRequestsResponseType> {
      const query = validate(listRequestsQuerySchema, input);
      const visible = visibleRequests(tenantId, callerId);
      const [rows, [counted]] = await Promise.all([
        repo.list(db, tenantId, callerId, query, visible),
        repo.count(db, tenantId, callerId, query, visible),
      ]);
      const calendar = rows.some((row) => row.state === "in_progress")
        ? await loadCalendar(db, tenantId)
        : null;
      return { requests: rows.map((row) => toSummary(row, calendar)), total: counted?.total ?? 0 };
    },

    async get(tenantId: string, callerId: string, requestId: string): Promise<RequestType> {
      const [row] = await repo.findById(
        db,
        tenantId,
        existingRequestId(requestId),
        visibleRequests(tenantId, callerId),
      );
      if (!row) {
        throw new AppError("NOT_FOUND");
      }
      return toRequest(db, row, callerId);
    },

    /** A reviewer changes the priority while the request is in review (R6.9). */
    changePriority(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: ChangePriorityRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(changePriorityRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertGrantsHeld(tx, tenantId, callerId, REVIEW);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_review");
        const [priority] = await repo.lockPriority(tx, tenantId, body.priorityId);
        if (!priority) {
          throw invalid("priorityId", "unknown_priority");
        }
        if (priority.retiredAt) {
          throw invalid("priorityId", "priority_retired");
        }
        if (priority.id === request.priorityId) {
          return reload(tx, tenantId, id, callerId);
        }
        await repo.update(tx, tenantId, id, {
          priorityId: priority.id,
          priorityName: priority.name,
          priorityDays: priority.days,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.priority_changed",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            before: { name: request.priorityName, days: request.priorityDays },
            after: { name: priority.name, days: priority.days },
            reason: body.reason,
          },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** A reviewer accepts a request in review with a handler and an allowed workflow (R6.10, R6.11). */
    accept(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: AcceptRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(acceptRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertGrantsHeld(tx, tenantId, callerId, REVIEW);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_review");
        const handlerUnitId = await handlerUnitOf(
          tx,
          tenantId,
          request.requesterId,
          body.handlerId,
        );

        const [workflow] = await repo.lockWorkflow(tx, tenantId, body.workflowId);
        if (!workflow) {
          throw invalid("workflowId", "unknown_workflow");
        }
        if (workflow.retiredAt) {
          throw invalid("workflowId", "workflow_retired");
        }
        if ((await repo.serviceAllows(tx, tenantId, request.serviceId, workflow.id)).length === 0) {
          throw invalid("workflowId", "workflow_not_allowed");
        }

        await repo.update(tx, tenantId, id, {
          state: "in_progress",
          handlerId: body.handlerId,
          handlerUnitId,
          workflowId: workflow.id,
          workflowVersionId: workflow.currentVersionId,
          acceptedAt: await repo.now(tx),
          acceptedBy: callerId,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.accepted",
          resourceType: "request",
          resourceId: id,
          details: {
            handlerId: body.handlerId,
            workflow: { id: workflow.id, versionId: workflow.currentVersionId },
            priority: { name: request.priorityName, days: request.priorityDays },
          },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** A reviewer rejects a request in review with a reason (R6.12). */
    reject(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertGrantsHeld(tx, tenantId, callerId, REVIEW);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_review");
        await closeRequest(tx, request, {
          outcome: "rejected",
          actorId: callerId,
          reason: body.reason,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.rejected",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: { reason: body.reason },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The requester withdraws a request before acceptance (R6.12). */
    withdraw(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        const request = await lockRequest(tx, tenantId, callerId, id);
        if (request.requesterId !== callerId) {
          throw new AppError("FORBIDDEN");
        }
        assertState(request, "in_review");
        await closeRequest(tx, request, {
          outcome: "withdrawn",
          actorId: callerId,
          reason: body.reason,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.withdrawn",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: { reason: body.reason },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },
  };
}
