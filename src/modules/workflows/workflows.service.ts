import { randomUUID } from "node:crypto";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import {
  createWorkflowRequestSchema,
  listWorkflowsQuerySchema,
  updateWorkflowRequestSchema,
  versionNumberSchema,
  workflowIdSchema,
} from "./workflows.schemas.js";
import type {
  CreateWorkflowRequestType,
  ListWorkflowsResponseType,
  StageInputType,
  StageRowType,
  StageType,
  UpdateWorkflowRequestType,
  VersionType,
  WorkflowRowType,
  WorkflowSummaryType,
  WorkflowsRepositoryType,
  WorkflowType,
} from "./workflows.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingWorkflowId(workflowId: string): string {
  if (!workflowIdSchema.safeParse(workflowId).success) {
    throw new AppError("NOT_FOUND");
  }
  return workflowId;
}

const toStage = (row: StageRowType): StageType => ({
  id: row.id,
  name: row.name,
  assignee: row.targetPositionId
    ? { position: row.targetPositionId, name: row.positionName }
    : { builtin: row.targetBuiltin as NonNullable<StageRowType["targetBuiltin"]> },
  whenUnresolved: row.whenUnresolved,
  handlerMayNarrow: row.handlerMayNarrow,
  handlerMayEscalate: row.handlerMayEscalate,
  excludeParties: row.excludeParties,
});

/** A stored stage in the shape a save sends, so a save can be compared with the current version. */
const toStageInput = (row: StageRowType): StageInputType => ({
  name: row.name,
  assignee: row.targetPositionId
    ? { position: row.targetPositionId }
    : { builtin: row.targetBuiltin as NonNullable<StageRowType["targetBuiltin"]> },
  whenUnresolved: row.whenUnresolved,
  handlerMayNarrow: row.handlerMayNarrow,
  handlerMayEscalate: row.handlerMayEscalate,
  excludeParties: row.excludeParties,
});

/** Field order is fixed, so equal stages give equal text. */
const stagesKey = (stages: StageInputType[]) =>
  JSON.stringify(
    stages.map((stage) => [
      stage.name,
      "position" in stage.assignee
        ? ["position", stage.assignee.position]
        : ["builtin", stage.assignee.builtin],
      stage.whenUnresolved,
      stage.handlerMayNarrow,
      stage.handlerMayEscalate,
      stage.excludeParties,
    ]),
  );

const toSummary = (row: WorkflowRowType): WorkflowSummaryType => ({
  id: row.id,
  name: row.name,
  retired: row.retiredAt !== null,
  version: {
    number: row.versionNumber,
    createdAt: row.versionCreatedAt,
    createdBy: row.versionCreatedBy,
  },
  // Versions are numbered 1, 2, 3, ... and never removed, so the current number is the count.
  versionCount: row.versionNumber,
});

export function createWorkflowsService({ db, repo }: { db: Db; repo: WorkflowsRepositoryType }) {
  async function loadWorkflow(
    executor: Executor,
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowType> {
    const [row] = await repo.findById(executor, tenantId, workflowId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    const stages = await repo.stagesOfVersion(executor, tenantId, row.currentVersionId);
    const { version, ...rest } = toSummary(row);
    return { ...rest, version: { ...version, stages: stages.map(toStage) } };
  }

  /** Locks the workflow; every change to one workflow runs after the previous one. */
  async function lockWorkflow(tx: Executor, tenantId: string, workflowId: string) {
    const [row] = await repo.findByIdForUpdate(tx, tenantId, workflowId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  /**
   * Locks every tenant position the stages name, so none can be retired until this transaction ends, and reports
   * the unknown and the retired (R5.10). A position of another tenant is unknown (R5.19).
   */
  async function lockStagePositions(
    tx: Executor,
    tenantId: string,
    stages: StageInputType[],
  ): Promise<ErrorDetail[]> {
    const named = [
      ...new Set(stages.flatMap((s) => ("position" in s.assignee ? [s.assignee.position] : []))),
    ];
    if (named.length === 0) {
      return [];
    }
    const states = new Map(
      (await repo.lockPositions(tx, tenantId, named)).map((state) => [state.id, state]),
    );
    const details: ErrorDetail[] = [];
    stages.forEach((stage, index) => {
      if (!("position" in stage.assignee)) {
        return;
      }
      const state = states.get(stage.assignee.position);
      const path = `stages.${index}.assignee.position`;
      if (!state) {
        details.push({ path, code: "unknown_position" });
      } else if (state.retiredAt) {
        details.push({ path, code: "position_retired" });
      }
    });
    return details;
  }

  async function assertStagePositionsActive(
    tx: Executor,
    tenantId: string,
    stages: StageInputType[],
  ) {
    const details = await lockStagePositions(tx, tenantId, stages);
    if (details.length > 0) {
      throw new AppError("VALIDATION_FAILED", details);
    }
  }

  async function insertVersion(
    tx: Executor,
    params: {
      tenantId: string;
      workflowId: string;
      versionId: string;
      number: number;
      createdBy: string;
      stages: StageInputType[];
    },
  ) {
    const { tenantId, workflowId, versionId, number, createdBy, stages } = params;
    await repo.insertVersion(tx, { id: versionId, tenantId, workflowId, number, createdBy });
    await repo.insertStages(tx, tenantId, versionId, stages);
  }

  const actorOf = (context: AuditContextType) => {
    if (context.actor.type !== "user" || !context.actor.id) {
      throw new Error("a workflow is saved by a tenant user");
    }
    return context.actor.id;
  };

  return {
    async list(tenantId: string, input: unknown): Promise<ListWorkflowsResponseType> {
      const { includeRetired } = validate(listWorkflowsQuerySchema, input);
      const rows = await repo.list(db, tenantId, includeRetired);
      return { workflows: rows.map(toSummary) };
    },

    get(tenantId: string, workflowId: string): Promise<WorkflowType> {
      return loadWorkflow(db, tenantId, existingWorkflowId(workflowId));
    },

    /** Any version, current or earlier; earlier versions never change (R5.9). */
    async getVersion(
      tenantId: string,
      workflowId: string,
      versionNumber: string,
    ): Promise<VersionType> {
      const id = existingWorkflowId(workflowId);
      if (!versionNumberSchema.safeParse(versionNumber).success) {
        throw new AppError("NOT_FOUND");
      }
      const [version] = await repo.versionByNumber(db, tenantId, id, Number(versionNumber));
      if (!version) {
        throw new AppError("NOT_FOUND");
      }
      const stages = await repo.stagesOfVersion(db, tenantId, version.id);
      return {
        number: version.number,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
        stages: stages.map(toStage),
      };
    },

    /** Creates the workflow with version 1. A duplicate name (any case) reaches the error handler as WORKFLOW_NAME_TAKEN. */
    create(
      tenantId: string,
      input: CreateWorkflowRequestType,
      context: AuditContextType,
    ): Promise<WorkflowType> {
      const body = validate(createWorkflowRequestSchema, input);
      const createdBy = actorOf(context);
      return withTx(db, async (tx) => {
        await assertStagePositionsActive(tx, tenantId, body.stages);
        const workflowId = randomUUID();
        const versionId = randomUUID();
        // The workflow names its version before the version exists; the key is checked at commit (migration 0010).
        await repo.insertWorkflow(tx, {
          id: workflowId,
          tenantId,
          name: body.name,
          currentVersionId: versionId,
        });
        await insertVersion(tx, {
          tenantId,
          workflowId,
          versionId,
          number: 1,
          createdBy,
          stages: body.stages,
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "workflow.created",
          resourceType: "workflow",
          resourceId: workflowId,
          details: { name: body.name, version: 1, stages: body.stages },
        });
        return loadWorkflow(tx, tenantId, workflowId);
      });
    },

    /**
     * Saves a name and stages based on `baseVersion` (R5.9). Only changed stages create a version; a rename alone
     * does not; a save that changes nothing writes nothing.
     */
    update(
      tenantId: string,
      workflowId: string,
      input: UpdateWorkflowRequestType,
      context: AuditContextType,
    ): Promise<WorkflowType> {
      const id = existingWorkflowId(workflowId);
      const body = validate(updateWorkflowRequestSchema, input);
      const createdBy = actorOf(context);
      return withTx(db, async (tx) => {
        const workflow = await lockWorkflow(tx, tenantId, id);
        if (workflow.retiredAt) {
          throw new AppError("RESOURCE_RETIRED");
        }
        const [current] = await repo.versionById(tx, tenantId, workflow.currentVersionId);
        if (!current) {
          throw new Error("workflow has no current version");
        }
        if (body.baseVersion !== current.number) {
          throw new AppError("WORKFLOW_VERSION_CHANGED");
        }
        await assertStagePositionsActive(tx, tenantId, body.stages);

        const currentStages = await repo.stagesOfVersion(tx, tenantId, current.id);
        const stagesChanged = stagesKey(body.stages) !== stagesKey(currentStages.map(toStageInput));
        const nameChanged = body.name !== workflow.name;
        if (!stagesChanged && !nameChanged) {
          return loadWorkflow(tx, tenantId, id);
        }

        const versionId = randomUUID();
        if (stagesChanged) {
          await insertVersion(tx, {
            tenantId,
            workflowId: id,
            versionId,
            number: current.number + 1,
            createdBy,
            stages: body.stages,
          });
        }
        await repo.update(tx, tenantId, id, {
          ...(nameChanged ? { name: body.name } : {}),
          ...(stagesChanged ? { currentVersionId: versionId } : {}),
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "workflow.updated",
          resourceType: "workflow",
          resourceId: id,
          details: {
            before: { name: workflow.name },
            after: { name: body.name },
            ...(stagesChanged ? { version: current.number + 1, stages: body.stages } : {}),
          },
        });
        return loadWorkflow(tx, tenantId, id);
      });
    },

    /** Hides the workflow from new use (R5.15). Repeating it is a no-op. */
    retire(tenantId: string, workflowId: string, context: AuditContextType): Promise<WorkflowType> {
      const id = existingWorkflowId(workflowId);
      return withTx(db, async (tx) => {
        const workflow = await lockWorkflow(tx, tenantId, id);
        if (workflow.retiredAt) {
          return loadWorkflow(tx, tenantId, id);
        }
        // Step 5.3 refuses here with WORKFLOW_IN_USE while an active service allows this workflow (R5.16); the
        // lock above makes that check hold.
        await repo.setRetired(tx, tenantId, id, true);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "workflow.retired",
          resourceType: "workflow",
          resourceId: id,
        });
        return loadWorkflow(tx, tenantId, id);
      });
    },

    /** Brings a retired workflow back (R5.15); a name taken meanwhile is WORKFLOW_NAME_TAKEN. Repeating it is a no-op. */
    restore(
      tenantId: string,
      workflowId: string,
      context: AuditContextType,
    ): Promise<WorkflowType> {
      const id = existingWorkflowId(workflowId);
      return withTx(db, async (tx) => {
        const workflow = await lockWorkflow(tx, tenantId, id);
        if (!workflow.retiredAt) {
          return loadWorkflow(tx, tenantId, id);
        }
        // An active workflow never names a retired position, so its positions are restored first.
        const stages = await repo.stagesOfVersion(tx, tenantId, workflow.currentVersionId);
        const retired = await lockStagePositions(tx, tenantId, stages.map(toStageInput));
        if (retired.length > 0) {
          throw new AppError("WORKFLOW_POSITION_RETIRED", retired);
        }
        await repo.setRetired(tx, tenantId, id, false);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "workflow.restored",
          resourceType: "workflow",
          resourceId: id,
        });
        return loadWorkflow(tx, tenantId, id);
      });
    },
  };
}
