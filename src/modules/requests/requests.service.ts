import type { Readable } from "node:stream";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor, Tx } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import { loadCalendar } from "@/modules/calendar/index.js";
import { isEscalationConfigured } from "@/modules/escalation/index.js";
import {
  attachFiles,
  discardFiles,
  type FileDownloadType,
  storageKeyOf,
} from "@/modules/files/index.js";
import { snapshotAnswers, validateAnswers } from "@/modules/services/index.js";
import {
  assertGrantsHeld,
  type GrantMapType,
  loadMemberGrants,
} from "@/modules/tenant-access/index.js";
import type { FileStoreType } from "@/storage/index.js";
import { MAX_REQUEST_FILES, NUMBER_PREFIX } from "./requests.config.js";
import {
  acceptRequestSchema,
  answerInformationRequestSchema,
  askInformationRequestSchema,
  attachFilesRequestSchema,
  changeHandlerRequestSchema,
  changePriorityRequestSchema,
  completeStageRequestSchema,
  listRequestsQuerySchema,
  narrowStageRequestSchema,
  reasonRequestSchema,
  refreshStageRequestSchema,
  requestIdSchema,
  submitRequestSchema,
} from "./requests.schemas.js";
import type {
  AcceptRequestType,
  ActiveStageType,
  AnswerFileType,
  AnswerInformationRequestType,
  AskInformationRequestType,
  AttachFilesRequestType,
  CatalogType,
  ChangeHandlerRequestType,
  ChangePriorityRequestType,
  CompleteStageRequestType,
  InformationRequestListRowType,
  InformationRequestType,
  ListRequestsResponseType,
  NarrowStageRequestType,
  NewRequestFileType,
  ReasonRequestType,
  RefreshStageRequestType,
  RequestAnswerType,
  RequestDetailRowType,
  RequestFileRowType,
  RequestFileType,
  RequestRowType,
  RequestSummaryRowType,
  RequestSummaryType,
  RequestsRepositoryType,
  RequestType,
  ServiceRowType,
  SlaType,
  StageAssigneeRowType,
  StageDefRowType,
  StageRunRowType,
  StageRunType,
  StageRunViewRowType,
  SubmitRequestType,
} from "./requests.types.js";
import { notifyAbout, notifyStageChanges, numberOf } from "./shared/notices.js";
import { nextNumber } from "./shared/numbers.js";
import { awaitingInfoDaysOf, closeRequest, frozenSlaOf, slaOf } from "./shared/sla.js";
import { isLiveStageAssignee } from "./shared/stage-assignees.js";
import {
  type ActorType,
  assigneeIdsOf,
  auditCompletion,
  completeRun,
  escalateRun,
  narrowRun,
  qualifiesFor,
  refreshRun,
  returnRun,
  startStage,
  type TransitionType,
} from "./shared/stages.js";
import { visibleRequests } from "./shared/visibility.js";

const REVIEW = [{ key: "request.review", scope: "organization" }] as const;
const REASSIGN = [{ key: "request.reassign", scope: "organization" }] as const;

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingRequestId(requestId: string): string {
  if (!requestIdSchema.safeParse(requestId).success) {
    throw new AppError("NOT_FOUND");
  }
  return requestId;
}

/** The same for a file or information request ID in a path. */
function existingChildId(fileId: string): string {
  const parsed = requestIdSchema.safeParse(fileId);
  if (!parsed.success) {
    throw new AppError("NOT_FOUND");
  }
  return parsed.data;
}

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

function assertState(request: RequestRowType, state: RequestRowType["state"]): void {
  if (request.state !== state) {
    throw new AppError("INVALID_REQUEST_STATE");
  }
}

const isOpen = (request: Pick<RequestRowType, "state">) =>
  request.state === "in_review" || request.state === "in_progress";

function assertOpen(request: RequestRowType): void {
  if (!isOpen(request)) {
    throw new AppError("INVALID_REQUEST_STATE");
  }
}

const toInformation = (
  row: InformationRequestListRowType,
  files: RequestFileType[],
): InformationRequestType => ({
  id: row.id,
  askedBy: { id: row.askedBy, name: row.askedByName },
  askedIn: row.askedIn,
  question: row.question,
  askedAt: row.askedAt,
  state: row.state,
  answer: row.answer,
  endedAt: row.endedAt,
  endedBy: row.endedBy && row.endedByName ? { id: row.endedBy, name: row.endedByName } : null,
  files: files.filter((file) => file.informationRequestId === row.id),
});

const toFile = (row: RequestFileRowType): RequestFileType => ({
  id: row.id,
  name: row.name,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  sha256: row.sha256,
  fieldId: row.fieldId,
  informationRequestId: row.informationRequestId,
  attachedBy: { id: row.attachedBy, name: row.attachedByName },
  attachedAt: row.attachedAt,
});

/** The snapshot with each file field's files listed; one no longer attached is shown as removed (R6.25). */
function answersWithFiles(
  answers: RequestDetailRowType["answers"],
  files: RequestFileType[],
): RequestAnswerType[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  return answers.map((answer) => {
    if (answer.field.type !== "file" || !Array.isArray(answer.value)) {
      return answer;
    }
    return {
      ...answer,
      files: (answer.value as string[]).map((id): AnswerFileType => {
        const file = byId.get(id);
        return file
          ? {
              id,
              removed: false,
              name: file.name,
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
            }
          : { id, removed: true };
      }),
    };
  });
}

/** A closure record from a stage action means the last stage ended and the request completed (R6.15). */
async function notifyCompleted(
  tx: Tx,
  request: RequestRowType,
  actorId: string,
  closure: SlaType | null,
): Promise<void> {
  if (closure) {
    await notifyAbout(tx, request, {
      kind: "request.completed",
      recipients: [request.requesterId],
      actorId,
    });
  }
}

/** The live deadline of a request in progress, the frozen one of a closed request, otherwise none. */
const deadlineOf = (
  row: RequestSummaryRowType,
  calendar: Awaited<ReturnType<typeof loadCalendar>> | null,
): Date | null =>
  row.state === "in_progress" && calendar
    ? (slaOf(row, calendar)?.deadline ?? null)
    : (frozenSlaOf(row)?.deadline ?? null);

const isLive = (run: Pick<StageRunRowType, "state">) =>
  run.state === "active" || run.state === "held";

const peopleOf = (assignees: StageAssigneeRowType[], runId: string) =>
  assignees
    .filter((assignee) => assignee.runId === runId)
    .map(({ userId, name }) => ({ id: userId, name }));

/** The stage the request is at and who it waits on, from the live run among `runs`. */
function activeStageOf(
  runs: StageRunViewRowType[],
  assignees: StageAssigneeRowType[],
): ActiveStageType | null {
  const live = runs.find(isLive);
  return live ? { name: live.stageName, waitingOn: peopleOf(assignees, live.id) } : null;
}

const toStageRun = (run: StageRunViewRowType, assignees: StageAssigneeRowType[]): StageRunType => ({
  id: run.id,
  stage: { id: run.workflowStageId, name: run.stageName, ordinal: run.ordinal },
  state: run.state,
  narrowed: run.narrowed,
  escalated: run.escalated,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
  endedBy: run.endedBy && run.endedByName ? { id: run.endedBy, name: run.endedByName } : null,
  comment: run.comment,
  assignees: peopleOf(assignees, run.id),
});

function toSummary(
  row: RequestSummaryRowType,
  calendar: Awaited<ReturnType<typeof loadCalendar>> | null,
  activeStage: ActiveStageType | null,
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
    activeStage,
  };
}

/** The actions the caller may take on the request now, so the web app shows only valid buttons (4.2). */
async function allowedActionsOf(
  executor: Executor,
  repo: RequestsRepositoryType,
  row: RequestDetailRowType,
  callerId: string,
  grants: GrantMapType,
  runs: StageRunViewRowType[],
  can: { attach: boolean; ask: boolean; openQuestion: InformationRequestListRowType | undefined },
): Promise<string[]> {
  const actions: string[] = [];
  if (can.attach) {
    actions.push("attach_files");
  }
  if (can.ask && !can.openQuestion) {
    actions.push("ask_information");
  }
  if (can.openQuestion) {
    if (row.requesterId === callerId) {
      actions.push("answer_information");
    }
    if (can.openQuestion.askedBy === callerId || row.handlerId === callerId) {
      actions.push("cancel_information");
    }
    if (row.state === "in_progress" && row.handlerId === callerId) {
      actions.push("close_no_response");
    }
  }
  if (row.state === "in_review") {
    if (row.requesterId === callerId) {
      actions.push("withdraw");
    }
    if (grants.has("request.review")) {
      actions.push("change_priority", "accept", "reject");
    }
  }
  if (row.state !== "in_progress") {
    return actions;
  }
  if (grants.has("request.reassign")) {
    actions.push("reassign");
  }
  const live = runs.find(isLive);
  if (!live || !row.workflowVersionId) {
    return actions;
  }
  const stage = (await repo.stageDefs(executor, row.tenantId, row.workflowVersionId)).find(
    (candidate) => candidate.id === live.workflowStageId,
  );
  if (!stage) {
    return actions;
  }
  const active = live.state === "active";
  if (active && (await qualifiesFor(executor, row, live, stage, callerId))) {
    actions.push("complete");
    if (runs.some((run) => run.state === "completed" && run.ordinal < live.ordinal)) {
      actions.push("return");
    }
  }
  if (row.handlerId === callerId) {
    actions.push("refresh");
    if (active && stage.handlerMayNarrow) {
      actions.push("narrow");
    }
    if (active && stage.handlerMayEscalate) {
      actions.push("escalate");
    }
  }
  return actions;
}

export function createRequestsService({
  db,
  repo,
  store,
}: {
  db: Db;
  repo: RequestsRepositoryType;
  store: FileStoreType;
}) {
  /**
   * Who may attach files (R6.24): the requester, the handler, a current assignee of the live stage, and a reviewer
   * while the request is in review. Read from the database now, not from the token.
   */
  async function mayAttach(
    executor: Executor,
    request: RequestRowType,
    callerId: string,
    grants: GrantMapType,
  ): Promise<boolean> {
    if (!isOpen(request)) {
      return false;
    }
    if (request.requesterId === callerId || request.handlerId === callerId) {
      return true;
    }
    if (request.state === "in_review") {
      return grants.has("request.review");
    }
    return isLiveStageAssignee(executor, request, callerId);
  }

  /**
   * Who may ask the requester a question (R6.20): a reviewer while the request is in review, the handler or a
   * current assignee of the live stage while it is in progress.
   */
  async function mayAsk(
    executor: Executor,
    request: RequestRowType,
    callerId: string,
    grants: GrantMapType,
  ): Promise<boolean> {
    if (request.state === "in_review") {
      return grants.has("request.review");
    }
    if (request.state === "in_progress") {
      return (
        request.handlerId === callerId || (await isLiveStageAssignee(executor, request, callerId))
      );
    }
    return false;
  }

  /** A deactivated member's token stays valid for a while; party actions check the database (D31). */
  async function assertActiveCaller(tx: Tx, tenantId: string, callerId: string): Promise<void> {
    if ((await repo.isActiveMember(tx, tenantId, callerId)).length === 0) {
      throw new AppError("FORBIDDEN");
    }
  }

  async function runsWithAssignees(
    executor: Executor,
    tenantId: string,
    requestIds: string[],
    liveOnly = false,
  ) {
    const runs = await repo.runsOf(executor, tenantId, requestIds, liveOnly);
    const assignees = await repo.assigneesOf(
      executor,
      tenantId,
      runs.map((run) => run.id),
    );
    return { runs, assignees };
  }

  /** The request page for a caller who is already known to see it. */
  async function toRequest(
    executor: Executor,
    row: RequestDetailRowType,
    callerId: string,
  ): Promise<RequestType> {
    const calendar =
      row.state === "in_progress" ? await loadCalendar(executor, row.tenantId) : null;
    const grants = await loadMemberGrants(executor, row.tenantId, callerId);
    const { runs, assignees } = await runsWithAssignees(executor, row.tenantId, [row.id]);
    const files = (await repo.filesOf(executor, row.tenantId, row.id)).map(toFile);
    const questions = await repo.informationOf(executor, row.tenantId, row.id);
    const can = {
      attach: await mayAttach(executor, row, callerId, grants),
      ask: await mayAsk(executor, row, callerId, grants),
      openQuestion: questions.find((question) => question.state === "open"),
    };
    return {
      ...toSummary(row, calendar, activeStageOf(runs, assignees)),
      answers: answersWithFiles(row.answers, files),
      files,
      informationRequests: questions.map((question) => toInformation(question, files)),
      stages: runs.map((run) => toStageRun(run, assignees)),
      sla:
        calendar && row.acceptedAt
          ? slaOf(
              row,
              calendar,
              new Date(),
              awaitingInfoDaysOf(calendar, row.acceptedAt, questions, new Date()),
            )
          : frozenSlaOf(row),
      allowedActions: await allowedActionsOf(executor, repo, row, callerId, grants, runs, can),
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

  const actorOf = (id: string, audit: AuditContextType): ActorType => ({ id, audit });

  /**
   * The request's live run and its stage, for an action on `runId` (R6.14): the run must be the live run of the
   * request, and `active` unless the action also works on a held one. A closed request has no live run, so the
   * second of two completions of the last stage gets STAGE_NOT_ACTIVE too.
   */
  async function liveStage(
    tx: Tx,
    request: RequestRowType,
    runId: string,
    options: { allowHeld?: boolean } = {},
  ): Promise<{ run: StageRunRowType; stage: StageDefRowType; stages: StageDefRowType[] }> {
    const [run] = await repo.liveRun(tx, request.tenantId, request.id);
    if (!run || run.id !== runId || (run.state !== "active" && !options.allowHeld)) {
      throw new AppError("STAGE_NOT_ACTIVE");
    }
    const stages = await repo.stageDefs(tx, request.tenantId, run.workflowVersionId);
    const stage = stages.find((candidate) => candidate.id === run.workflowStageId);
    if (!stage) {
      throw new Error("a run belongs to a stage of its version");
    }
    return { run, stage, stages };
  }

  const assertHandler = (request: RequestRowType, callerId: string) => {
    if (request.handlerId !== callerId) {
      throw new AppError("FORBIDDEN");
    }
  };

  /** The run's assignees and level as an audit entry shows them. */
  const standingOf = async (tx: Tx, request: RequestRowType, run: StageRunRowType) => ({
    state: run.state,
    assignees: await assigneeIdsOf(tx, request, run),
    level: run.level,
  });

  /**
   * Attaches the files named in file answers and in `fileIds` and links them to the new request (R6.3, R6.24).
   * Refusals keep the paths of Phase 5.5: `answers.<field ID>.<index>` inside a file answer, `fileIds.<index>`
   * for the extra files.
   */
  async function attachSubmissionFiles(
    tx: Tx,
    tenantId: string,
    callerId: string,
    requestId: string,
    form: ServiceRowType["form"],
    body: { answers: Record<string, unknown>; fileIds?: string[] | undefined },
  ): Promise<string[]> {
    const groups = [
      ...form.flatMap((field) => {
        const ids = body.answers[field.id];
        return field.type === "file" && Array.isArray(ids)
          ? [{ fieldId: field.id, ids: ids as string[] }]
          : [];
      }),
      { fieldId: null, ids: body.fileIds ?? [] },
    ];
    if (groups.reduce((sum, group) => sum + group.ids.length, 0) > MAX_REQUEST_FILES) {
      throw new AppError("TOO_MANY_FILES");
    }
    const details: ErrorDetail[] = [];
    const rows: NewRequestFileType[] = [];
    for (const group of groups) {
      try {
        const files = await attachFiles(tx, tenantId, callerId, group.ids);
        rows.push(
          ...files.map((file) => ({
            tenantId,
            requestId,
            fileId: file.id,
            fieldId: group.fieldId,
            attachedBy: callerId,
          })),
        );
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== "VALIDATION_FAILED") {
          throw err;
        }
        details.push(
          ...(err.details ?? []).map((detail) =>
            group.fieldId
              ? { ...detail, path: detail.path.replace(/^fileIds\./, `answers.${group.fieldId}.`) }
              : detail,
          ),
        );
      }
    }
    if (details.length > 0) {
      throw new AppError("VALIDATION_FAILED", details);
    }
    if (rows.length > 0) {
      await repo.insertFiles(tx, rows);
    }
    return rows.map((row) => row.fileId);
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
        const attached = await attachSubmissionFiles(
          tx,
          tenantId,
          callerId,
          created.id,
          service.form,
          body,
        );
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
            fileIds: attached,
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
      const { runs, assignees } = await runsWithAssignees(
        db,
        tenantId,
        rows.map((row) => row.id),
        true,
      );
      return {
        requests: rows.map((row) =>
          toSummary(
            row,
            calendar,
            activeStageOf(
              runs.filter((run) => run.requestId === row.id),
              assignees,
            ),
          ),
        ),
        total: counted?.total ?? 0,
      };
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
        await notifyAbout(tx, request, {
          kind: "request.priority_changed",
          recipients: [request.requesterId],
          actorId: callerId,
          data: { before: request.priorityName, after: priority.name },
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

        const [accepted] = await repo.update(tx, tenantId, id, {
          state: "in_progress",
          handlerId: body.handlerId,
          handlerUnitId,
          workflowId: workflow.id,
          workflowVersionId: workflow.currentVersionId,
          acceptedAt: await repo.now(tx),
          acceptedBy: callerId,
        });
        if (!accepted) {
          throw new Error("the accept update returned no row");
        }
        const transitions: TransitionType[] = [];
        const stages = await repo.stageDefs(tx, tenantId, workflow.currentVersionId);
        const closure = await startStage(
          tx,
          accepted,
          stages,
          0,
          actorOf(callerId, context),
          transitions,
        );
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
            transitions,
          },
        });
        await auditCompletion(tx, accepted, actorOf(callerId, context), closure);
        await notifyAbout(tx, accepted, {
          kind: "request.accepted",
          recipients: [accepted.requesterId],
          actorId: callerId,
        });
        await notifyAbout(tx, accepted, {
          kind: "request.handler_assigned",
          recipients: [body.handlerId],
          actorId: callerId,
        });
        await notifyStageChanges(tx, accepted, callerId, stages, transitions);
        await notifyCompleted(tx, accepted, callerId, closure);
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
        await notifyAbout(tx, request, {
          kind: "request.rejected",
          recipients: [request.requesterId],
          actorId: callerId,
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
        await assertActiveCaller(tx, tenantId, callerId);
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

    /** An assignee who still qualifies completes the active run (R6.14, R6.15). */
    completeStage(
      tenantId: string,
      callerId: string,
      requestId: string,
      runId: string,
      input: CompleteStageRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const run = existingRequestId(runId);
      const body = validate(completeStageRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        const live = await liveStage(tx, request, run);
        if (!(await qualifiesFor(tx, request, live.run, live.stage, callerId))) {
          throw new AppError("FORBIDDEN");
        }
        const transitions: TransitionType[] = [];
        const closure = await completeRun(
          tx,
          request,
          live.stages,
          live.run,
          body.comment,
          actorOf(callerId, context),
          transitions,
        );
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.stage_completed",
          resourceType: "request",
          resourceId: id,
          details: {
            run: live.run.id,
            stage: live.run.workflowStageId,
            comment: body.comment ?? null,
            transitions,
          },
        });
        await auditCompletion(tx, request, actorOf(callerId, context), closure);
        await notifyStageChanges(tx, request, callerId, live.stages, transitions);
        await notifyCompleted(tx, request, callerId, closure);
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** An assignee who still qualifies returns to the nearest earlier stage that ran (R6.16). */
    returnStage(
      tenantId: string,
      callerId: string,
      requestId: string,
      runId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const run = existingRequestId(runId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        const live = await liveStage(tx, request, run);
        if (!(await qualifiesFor(tx, request, live.run, live.stage, callerId))) {
          throw new AppError("FORBIDDEN");
        }
        const transitions: TransitionType[] = [];
        const closure = await returnRun(
          tx,
          request,
          live.stages,
          live.run,
          body.reason,
          actorOf(callerId, context),
          transitions,
        );
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.stage_returned",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            run: live.run.id,
            stage: live.run.workflowStageId,
            reason: body.reason,
            transitions,
          },
        });
        await auditCompletion(tx, request, actorOf(callerId, context), closure);
        await notifyStageChanges(tx, request, callerId, live.stages, transitions);
        await notifyCompleted(tx, request, callerId, closure);
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The handler narrows the assignees to some of them, where the stage allows it (R6.17). */
    narrowStage(
      tenantId: string,
      callerId: string,
      requestId: string,
      runId: string,
      input: NarrowStageRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const run = existingRequestId(runId);
      const body = validate(narrowStageRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_progress");
        assertHandler(request, callerId);
        const live = await liveStage(tx, request, run);
        if (!live.stage.handlerMayNarrow) {
          throw new AppError("FORBIDDEN");
        }
        const before = await assigneeIdsOf(tx, request, live.run);
        const notAssigned = body.userIds.flatMap((userId, index) =>
          before.includes(userId) ? [] : [{ path: `userIds.${index}`, code: "not_assignee" }],
        );
        if (notAssigned.length > 0) {
          throw new AppError("VALIDATION_FAILED", notAssigned);
        }
        await narrowRun(tx, request, live.run, body.userIds);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.stage_narrowed",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            run: live.run.id,
            before: { assignees: before },
            after: { assignees: body.userIds },
            reason: body.reason,
          },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The handler escalates the run to the next level up, where the stage allows it (R6.17). */
    escalateStage(
      tenantId: string,
      callerId: string,
      requestId: string,
      runId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const run = existingRequestId(runId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_progress");
        assertHandler(request, callerId);
        const live = await liveStage(tx, request, run);
        if (!live.stage.handlerMayEscalate) {
          throw new AppError("FORBIDDEN");
        }
        const before = await standingOf(tx, request, live.run);
        const after = await escalateRun(tx, request, live.stage, live.run);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.stage_escalated",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            run: live.run.id,
            before,
            after: { assignees: after.userIds, level: after.level },
            reason: body.reason,
          },
        });
        await notifyStageChanges(
          tx,
          request,
          callerId,
          live.stages,
          [
            {
              run: live.run.id,
              stage: live.run.workflowStageId,
              state: "active",
              assignees: after.userIds,
              level: after.level,
            },
          ],
          new Map([[live.run.id, before.assignees]]),
        );
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The handler resolves the live stage's assignees again (R6.18). */
    refreshStage(
      tenantId: string,
      callerId: string,
      requestId: string,
      runId: string,
      input: RefreshStageRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const run = existingRequestId(runId);
      const body = validate(refreshStageRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_progress");
        assertHandler(request, callerId);
        const live = await liveStage(tx, request, run, { allowHeld: true });
        const before = await standingOf(tx, request, live.run);
        const transitions: TransitionType[] = [];
        const closure = await refreshRun(
          tx,
          request,
          live.stages,
          live.run,
          actorOf(callerId, context),
          transitions,
        );
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.stage_refreshed",
          resourceType: "request",
          resourceId: id,
          ...(body.reason ? { reason: body.reason } : {}),
          details: { run: live.run.id, before, reason: body.reason ?? null, transitions },
        });
        await auditCompletion(tx, request, actorOf(callerId, context), closure);
        await notifyStageChanges(
          tx,
          request,
          callerId,
          live.stages,
          transitions,
          new Map([[live.run.id, before.assignees]]),
        );
        await notifyCompleted(tx, request, callerId, closure);
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** A holder of `request.reassign` changes the handler, and the live stage is resolved again for them (R6.19). */
    changeHandler(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: ChangeHandlerRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(changeHandlerRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertGrantsHeld(tx, tenantId, callerId, REASSIGN);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertState(request, "in_progress");
        if (request.handlerId === body.handlerId) {
          throw invalid("handlerId", "same_handler");
        }
        const handlerUnitId = await handlerUnitOf(
          tx,
          tenantId,
          request.requesterId,
          body.handlerId,
        );
        const [changed] = await repo.update(tx, tenantId, id, {
          handlerId: body.handlerId,
          handlerUnitId,
        });
        if (!changed) {
          throw new Error("the handler update returned no row");
        }
        const transitions: TransitionType[] = [];
        const [live] = await repo.liveRun(tx, tenantId, id);
        const stages = live ? await repo.stageDefs(tx, tenantId, live.workflowVersionId) : [];
        const assigneesBefore = live ? await assigneeIdsOf(tx, changed, live) : [];
        const closure = live
          ? await refreshRun(tx, changed, stages, live, actorOf(callerId, context), transitions)
          : null;
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.handler_changed",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            before: request.handlerId,
            after: body.handlerId,
            reason: body.reason,
            transitions,
          },
        });
        await auditCompletion(tx, changed, actorOf(callerId, context), closure);
        await notifyAbout(tx, changed, {
          kind: "request.handler_assigned",
          recipients: [body.handlerId],
          actorId: callerId,
        });
        if (request.handlerId) {
          await notifyAbout(tx, changed, {
            kind: "request.handler_removed",
            recipients: [request.handlerId],
            actorId: callerId,
          });
        }
        await notifyStageChanges(
          tx,
          changed,
          callerId,
          stages,
          transitions,
          live ? new Map([[live.id, assigneesBefore]]) : undefined,
        );
        await notifyCompleted(tx, changed, callerId, closure);
        return reload(tx, tenantId, id, callerId);
      });
    },
    /** Attaches the caller's pending uploads to an open request (R6.24). */
    attachFiles(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: AttachFilesRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(attachFilesRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertOpen(request);
        const grants = await loadMemberGrants(tx, tenantId, callerId);
        if (!(await mayAttach(tx, request, callerId, grants))) {
          throw new AppError("FORBIDDEN");
        }
        const [stored] = await repo.countFiles(tx, tenantId, id);
        if ((stored?.total ?? 0) + body.fileIds.length > MAX_REQUEST_FILES) {
          throw new AppError("TOO_MANY_FILES");
        }
        const files = await attachFiles(tx, tenantId, callerId, body.fileIds);
        await repo.insertFiles(
          tx,
          files.map((file) => ({ tenantId, requestId: id, fileId: file.id, attachedBy: callerId })),
        );
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.files_attached",
          resourceType: "request",
          resourceId: id,
          details: { fileIds: files.map((file) => file.id) },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** Deletes an attachment, by whoever attached it or by the handler, with a reason (R6.25). */
    removeFile(
      tenantId: string,
      callerId: string,
      requestId: string,
      fileId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const fileKey = existingChildId(fileId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        const [file] = await repo.findFile(tx, tenantId, id, fileKey);
        if (!file) {
          throw new AppError("NOT_FOUND");
        }
        if (file.attachedBy !== callerId && request.handlerId !== callerId) {
          throw new AppError("FORBIDDEN");
        }
        assertOpen(request);
        await repo.deleteFileLink(tx, tenantId, file.id);
        await discardFiles(tx, tenantId, [file.id]);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.file_removed",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: {
            file: { id: file.id, name: file.name, sizeBytes: file.sizeBytes, sha256: file.sha256 },
            reason: body.reason,
          },
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The bytes of an attached file for anyone who sees the request (R6.7, R6.24). */
    async openFile(
      tenantId: string,
      callerId: string,
      requestId: string,
      fileId: string,
    ): Promise<{ file: FileDownloadType; body: Readable }> {
      const id = existingRequestId(requestId);
      const fileKey = existingChildId(fileId);
      const [request] = await repo.findById(db, tenantId, id, visibleRequests(tenantId, callerId));
      const [file] = request ? await repo.findFile(db, tenantId, id, fileKey) : [];
      if (!file) {
        throw new AppError("NOT_FOUND");
      }
      return {
        file: { name: file.name, contentType: file.contentType, sizeBytes: file.sizeBytes },
        body: await store.get(storageKeyOf(tenantId, file.id)),
      };
    },

    /**
     * A reviewer in review, or the handler or a current stage assignee in progress, asks the requester a question
     * (R6.20). At most one is open per request.
     */
    askInformation(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: AskInformationRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(askInformationRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        assertOpen(request);
        const grants = await loadMemberGrants(tx, tenantId, callerId);
        if (!(await mayAsk(tx, request, callerId, grants))) {
          throw new AppError("FORBIDDEN");
        }
        if ((await repo.openInformation(tx, tenantId, id)).length > 0) {
          throw new AppError("INFORMATION_REQUEST_OPEN");
        }
        const [asked] = await repo.insertInformation(tx, {
          tenantId,
          requestId: id,
          askedBy: callerId,
          askedIn: request.state === "in_review" ? "review" : "execution",
          question: body.question,
        });
        if (!asked) {
          throw new Error("the information request insert returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.information_requested",
          resourceType: "request",
          resourceId: id,
          details: {
            informationRequestId: asked.id,
            askedIn: asked.askedIn,
            question: body.question,
          },
        });
        await notifyAbout(tx, request, {
          kind: "request.information_requested",
          recipients: [request.requesterId],
          actorId: callerId,
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The requester answers the open question with text and optional files, which closes it (R6.20). */
    answerInformation(
      tenantId: string,
      callerId: string,
      requestId: string,
      informationId: string,
      input: AnswerInformationRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const infoKey = existingChildId(informationId);
      const body = validate(answerInformationRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        const [question] = await repo.findInformation(tx, tenantId, id, infoKey);
        if (!question) {
          throw new AppError("NOT_FOUND");
        }
        if (request.requesterId !== callerId) {
          throw new AppError("FORBIDDEN");
        }
        if (question.state !== "open") {
          throw new AppError("NO_OPEN_INFORMATION_REQUEST");
        }
        const fileIds = body.fileIds ?? [];
        const [stored] = await repo.countFiles(tx, tenantId, id);
        if ((stored?.total ?? 0) + fileIds.length > MAX_REQUEST_FILES) {
          throw new AppError("TOO_MANY_FILES");
        }
        const files = await attachFiles(tx, tenantId, callerId, fileIds);
        if (files.length > 0) {
          await repo.insertFiles(
            tx,
            files.map((file) => ({
              tenantId,
              requestId: id,
              fileId: file.id,
              informationRequestId: question.id,
              attachedBy: callerId,
            })),
          );
        }
        await repo.endInformation(tx, tenantId, question.id, {
          state: "answered",
          answer: body.answer,
          endedAt: await repo.now(tx),
          endedBy: callerId,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.information_answered",
          resourceType: "request",
          resourceId: id,
          details: {
            informationRequestId: question.id,
            answer: body.answer,
            fileIds: files.map((file) => file.id),
          },
        });
        await notifyAbout(tx, request, {
          kind: "request.information_answered",
          recipients: [question.askedBy],
          actorId: callerId,
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** The question's asker or the handler withdraws it, which frees the request for a new one (Q25). */
    cancelInformation(
      tenantId: string,
      callerId: string,
      requestId: string,
      informationId: string,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const infoKey = existingChildId(informationId);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        const [question] = await repo.findInformation(tx, tenantId, id, infoKey);
        if (!question) {
          throw new AppError("NOT_FOUND");
        }
        if (question.askedBy !== callerId && request.handlerId !== callerId) {
          throw new AppError("FORBIDDEN");
        }
        if (question.state !== "open") {
          throw new AppError("NO_OPEN_INFORMATION_REQUEST");
        }
        await repo.endInformation(tx, tenantId, question.id, {
          state: "cancelled",
          endedAt: await repo.now(tx),
          endedBy: callerId,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.information_cancelled",
          resourceType: "request",
          resourceId: id,
          details: { informationRequestId: question.id },
        });
        await notifyAbout(tx, request, {
          kind: "request.information_cancelled",
          recipients: [request.requesterId],
          actorId: callerId,
        });
        return reload(tx, tenantId, id, callerId);
      });
    },

    /** While a question is open, the handler closes the request as "Rejected - no response" (R6.21). */
    closeNoResponse(
      tenantId: string,
      callerId: string,
      requestId: string,
      input: ReasonRequestType,
      context: AuditContextType,
    ): Promise<RequestType> {
      const id = existingRequestId(requestId);
      const body = validate(reasonRequestSchema, input);
      return withTx(db, async (tx) => {
        await assertActiveCaller(tx, tenantId, callerId);
        const request = await lockRequest(tx, tenantId, callerId, id);
        if (request.handlerId !== callerId) {
          throw new AppError("FORBIDDEN");
        }
        assertState(request, "in_progress");
        const [question] = await repo.openInformation(tx, tenantId, id);
        if (!question) {
          throw new AppError("NO_OPEN_INFORMATION_REQUEST");
        }
        const record = await closeRequest(tx, request, {
          outcome: "rejected_no_response",
          actorId: callerId,
          reason: body.reason,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "request.closed_no_response",
          resourceType: "request",
          resourceId: id,
          reason: body.reason,
          details: { reason: body.reason, informationRequestId: question.id, sla: record },
        });
        await notifyAbout(tx, request, {
          kind: "request.closed_no_response",
          recipients: [request.requesterId],
          actorId: callerId,
        });
        return reload(tx, tenantId, id, callerId);
      });
    },
  };
}
