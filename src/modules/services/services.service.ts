import { randomUUID } from "node:crypto";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import {
  createServiceRequestSchema,
  listServicesQuerySchema,
  serviceIdSchema,
  updateServiceRequestSchema,
} from "./services.schemas.js";
import type {
  AllowedWorkflowRowType,
  CreateServiceRequestType,
  ListServicesResponseType,
  ServiceRowType,
  ServicesRepositoryType,
  ServiceType,
  UpdateServiceRequestType,
  WorkflowChoiceType,
} from "./services.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingServiceId(serviceId: string): string {
  if (!serviceIdSchema.safeParse(serviceId).success) {
    throw new AppError("NOT_FOUND");
  }
  return serviceId;
}

const toService = (row: ServiceRowType, allowed: AllowedWorkflowRowType[]): ServiceType => ({
  id: row.id,
  name: row.name,
  description: row.description,
  retired: row.retiredAt !== null,
  workflows: allowed.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    isDefault: workflow.isDefault,
    retired: workflow.retiredAt !== null,
  })),
});

/** The choices in a fixed order, so equal lists give equal text. */
const choicesKey = (choices: WorkflowChoiceType[]) =>
  JSON.stringify(
    choices
      .map((choice) => [choice.id, choice.isDefault] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const toChoices = (allowed: AllowedWorkflowRowType[]): WorkflowChoiceType[] =>
  allowed.map((workflow) => ({ id: workflow.id, isDefault: workflow.isDefault }));

const workflowPath = (index: number) => `workflows.${index}.id`;

export function createServicesService({ db, repo }: { db: Db; repo: ServicesRepositoryType }) {
  async function loadService(
    executor: Executor,
    tenantId: string,
    serviceId: string,
  ): Promise<ServiceType> {
    const [row] = await repo.findById(executor, tenantId, serviceId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return toService(row, await repo.workflowsOf(executor, tenantId, [serviceId]));
  }

  /** Locks the service; every change to one service runs after the previous one. */
  async function lockService(tx: Executor, tenantId: string, serviceId: string) {
    const [row] = await repo.findByIdForUpdate(tx, tenantId, serviceId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  /**
   * Locks the listed workflows, so none can be retired until this transaction ends, and reports the positions of
   * the unknown and the retired. A workflow of another tenant is unknown (R5.19).
   */
  async function lockWorkflows(tx: Executor, tenantId: string, choices: WorkflowChoiceType[]) {
    const states = new Map(
      (
        await repo.lockWorkflows(
          tx,
          tenantId,
          choices.map((choice) => choice.id),
        )
      ).map((state) => [state.id, state]),
    );
    const unknown: number[] = [];
    const retired: number[] = [];
    choices.forEach((choice, index) => {
      const state = states.get(choice.id);
      if (!state) {
        unknown.push(index);
      } else if (state.retiredAt) {
        retired.push(index);
      }
    });
    return { unknown, retired };
  }

  async function assertWorkflowsActive(
    tx: Executor,
    tenantId: string,
    choices: WorkflowChoiceType[],
  ) {
    const { unknown, retired } = await lockWorkflows(tx, tenantId, choices);
    const details: (ErrorDetail & { index: number })[] = [
      ...unknown.map((index) => ({ index, path: workflowPath(index), code: "unknown_workflow" })),
      ...retired.map((index) => ({ index, path: workflowPath(index), code: "workflow_retired" })),
    ].sort((a, b) => a.index - b.index);
    if (details.length > 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        details.map(({ path, code }) => ({ path, code })),
      );
    }
  }

  return {
    async list(tenantId: string, input: unknown): Promise<ListServicesResponseType> {
      const { includeRetired } = validate(listServicesQuerySchema, input);
      const rows = await repo.list(db, tenantId, includeRetired);
      const allowed = await repo.workflowsOf(
        db,
        tenantId,
        rows.map((row) => row.id),
      );
      return {
        services: rows.map((row) =>
          toService(
            row,
            allowed.filter((workflow) => workflow.serviceId === row.id),
          ),
        ),
      };
    },

    get(tenantId: string, serviceId: string): Promise<ServiceType> {
      return loadService(db, tenantId, existingServiceId(serviceId));
    },

    /** A duplicate name (any case) reaches the error handler as SERVICE_NAME_TAKEN. */
    create(
      tenantId: string,
      input: CreateServiceRequestType,
      context: AuditContextType,
    ): Promise<ServiceType> {
      const body = validate(createServiceRequestSchema, input);
      const description = body.description ?? null;
      return withTx(db, async (tx) => {
        await assertWorkflowsActive(tx, tenantId, body.workflows);
        const id = randomUUID();
        await repo.insert(tx, { id, tenantId, name: body.name, description });
        await repo.replaceWorkflows(tx, tenantId, id, body.workflows);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "service.created",
          resourceType: "service",
          resourceId: id,
          details: { name: body.name, description, workflows: body.workflows },
        });
        return loadService(tx, tenantId, id);
      });
    },

    /**
     * Changes the given fields; a workflow list replaces the old one whole. A save that changes nothing writes
     * nothing.
     */
    update(
      tenantId: string,
      serviceId: string,
      input: UpdateServiceRequestType,
      context: AuditContextType,
    ): Promise<ServiceType> {
      const id = existingServiceId(serviceId);
      const body = validate(updateServiceRequestSchema, input);
      return withTx(db, async (tx) => {
        const service = await lockService(tx, tenantId, id);
        if (service.retiredAt) {
          throw new AppError("RESOURCE_RETIRED");
        }
        if (body.workflows) {
          await assertWorkflowsActive(tx, tenantId, body.workflows);
        }
        const current = toChoices(await repo.workflowsOf(tx, tenantId, [id]));

        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const patch: { name?: string; description?: string | null } = {};
        if (body.name !== undefined && body.name !== service.name) {
          patch.name = body.name;
          before.name = service.name;
          after.name = body.name;
        }
        if (body.description !== undefined && body.description !== service.description) {
          patch.description = body.description;
          before.description = service.description;
          after.description = body.description;
        }
        const newWorkflows =
          body.workflows && choicesKey(body.workflows) !== choicesKey(current)
            ? body.workflows
            : undefined;
        if (newWorkflows) {
          before.workflows = current;
          after.workflows = newWorkflows;
        }
        if (Object.keys(after).length === 0) {
          return loadService(tx, tenantId, id);
        }

        if (Object.keys(patch).length > 0) {
          await repo.update(tx, tenantId, id, patch);
        }
        if (newWorkflows) {
          await repo.replaceWorkflows(tx, tenantId, id, newWorkflows);
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "service.updated",
          resourceType: "service",
          resourceId: id,
          details: { before, after },
        });
        return loadService(tx, tenantId, id);
      });
    },

    /** Hides the service from new requests (R5.15). Repeating it is a no-op. */
    retire(tenantId: string, serviceId: string, context: AuditContextType): Promise<ServiceType> {
      const id = existingServiceId(serviceId);
      return withTx(db, async (tx) => {
        const service = await lockService(tx, tenantId, id);
        if (service.retiredAt) {
          return loadService(tx, tenantId, id);
        }
        await repo.setRetired(tx, tenantId, id, true);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "service.retired",
          resourceType: "service",
          resourceId: id,
        });
        return loadService(tx, tenantId, id);
      });
    },

    /**
     * Brings a retired service back (R5.15). Its workflows are share-locked, so none is retired while it becomes
     * active; a name taken meanwhile is SERVICE_NAME_TAKEN. Repeating it is a no-op.
     */
    restore(tenantId: string, serviceId: string, context: AuditContextType): Promise<ServiceType> {
      const id = existingServiceId(serviceId);
      return withTx(db, async (tx) => {
        const service = await lockService(tx, tenantId, id);
        if (!service.retiredAt) {
          return loadService(tx, tenantId, id);
        }
        const allowed = toChoices(await repo.workflowsOf(tx, tenantId, [id]));
        const { retired } = await lockWorkflows(tx, tenantId, allowed);
        if (retired.length > 0) {
          throw new AppError(
            "SERVICE_WORKFLOW_RETIRED",
            retired.map((index) => ({ path: workflowPath(index), code: "workflow_retired" })),
          );
        }
        await repo.setRetired(tx, tenantId, id, false);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "service.restored",
          resourceType: "service",
          resourceId: id,
        });
        return loadService(tx, tenantId, id);
      });
    },
  };
}
