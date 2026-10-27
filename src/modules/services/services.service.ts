import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { listPage } from "@/http/list.js";
import type { PageType } from "@/http/respond.js";
import { validate } from "@/http/validate.js";
import { SERVICE_SORT_KEYS } from "./services.repository.js";
import {
  createServiceRequestSchema,
  listServicesQuerySchema,
  serviceIdSchema,
  updateServiceFormRequestSchema,
  updateServiceRequestSchema,
} from "./services.schemas.js";
import type {
  AllowedWorkflowRowType,
  CreateServiceRequestType,
  RequestedFieldType,
  ServiceRowType,
  ServicesRepositoryType,
  ServiceType,
  UpdateServiceFormRequestType,
  UpdateServiceRequestType,
  WorkflowChoiceType,
} from "./services.types.js";
import { type FormFieldType, fieldView } from "./shared/form.js";

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
  form: { revision: row.formRevision, fields: row.form.map(fieldView) },
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

/**
 * The requested fields as stored fields: a sent ID must belong to the current form and keep its type, new fields
 * and options get new IDs (R5.5.5). Problems are reported at the request's paths.
 */
function resolveForm(
  current: FormFieldType[],
  requested: RequestedFieldType[],
): { fields: FormFieldType[]; details: ErrorDetail[] } {
  const currentById = new Map(current.map((field) => [field.id, field]));
  const details: ErrorDetail[] = [];
  const fields = requested.map((field, index): FormFieldType => {
    const at = `fields.${index}`;
    const existing = field.id === undefined ? undefined : currentById.get(field.id);
    if (field.id !== undefined && !existing) {
      details.push({ path: `${at}.id`, code: "unknown_field_id" });
    } else if (existing && existing.type !== field.type) {
      details.push({ path: `${at}.type`, code: "type_changed" });
    }
    const stored = { ...field, id: field.id ?? randomUUID() } as FormFieldType;
    if ("options" in field && "options" in stored) {
      // A new field has no options to keep; a field with a bad ID or changed type is already reported.
      const checkOptions = existing ? existing.type === field.type : field.id === undefined;
      const known = new Set(
        existing && "options" in existing ? existing.options.map((option) => option.id) : [],
      );
      stored.options = field.options.map((option, position) => {
        if (checkOptions && option.id !== undefined && !known.has(option.id)) {
          details.push({ path: `${at}.options.${position}.id`, code: "unknown_option_id" });
        }
        return { id: option.id ?? randomUUID(), label: option.label };
      });
    }
    return stored;
  });
  return { fields, details };
}

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
      ...unknown.map((index) => ({
        index,
        path: workflowPath(index),
        code: "unknown_workflow" as const,
      })),
      ...retired.map((index) => ({
        index,
        path: workflowPath(index),
        code: "workflow_retired" as const,
      })),
    ].sort((a, b) => a.index - b.index);
    if (details.length > 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        details.map(({ path, code }) => ({ path, code })),
      );
    }
  }

  return {
    async list(tenantId: string, input: unknown): Promise<PageType<ServiceType>> {
      const query = validate(listServicesQuerySchema, input);
      const page = await listPage({
        db,
        list: "services",
        query,
        keys: SERVICE_SORT_KEYS,
        direction: "asc",
        where: ({ retired }) => repo.listWhere(tenantId, retired),
        selectPage: (tx, request) => repo.selectPage(tx, request),
        count: (tx, where) => repo.count(tx, where),
      });
      const allowed = await repo.workflowsOf(
        db,
        tenantId,
        page.items.map((row) => row.id),
      );
      return {
        ...page,
        items: page.items.map((row) =>
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

    /**
     * Saves the whole form based on `baseRevision` (R5.5.4). A save that changes nothing writes nothing; one that
     * does increments the revision and is audited with the fields before and after.
     */
    updateForm(
      tenantId: string,
      serviceId: string,
      input: UpdateServiceFormRequestType,
      context: AuditContextType,
    ): Promise<ServiceType> {
      const id = existingServiceId(serviceId);
      const body = validate(updateServiceFormRequestSchema, input);
      return withTx(db, async (tx) => {
        const service = await lockService(tx, tenantId, id);
        if (service.retiredAt) {
          throw new AppError("RESOURCE_RETIRED");
        }
        if (body.baseRevision !== service.formRevision) {
          throw new AppError("VERSION_CHANGED", [
            { path: "baseRevision", code: "version_changed" },
          ]);
        }
        const { fields, details } = resolveForm(service.form, body.fields);
        if (details.length > 0) {
          throw new AppError("VALIDATION_FAILED", details);
        }
        if (isDeepStrictEqual(fields, service.form)) {
          return loadService(tx, tenantId, id);
        }
        const revision = service.formRevision + 1;
        await repo.setForm(tx, tenantId, id, fields, revision);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "service.form_updated",
          resourceType: "service",
          resourceId: id,
          details: { revision, before: service.form, after: fields },
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
            retired.map((index) => ({
              path: workflowPath(index),
              code: "workflow_retired" as const,
            })),
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
