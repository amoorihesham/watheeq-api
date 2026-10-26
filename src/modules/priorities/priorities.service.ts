import { randomUUID } from "node:crypto";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError } from "@/http/errors.js";
import { listPage } from "@/http/list.js";
import type { PageType } from "@/http/respond.js";
import { validate } from "@/http/validate.js";
import { PRIORITY_SORT_KEYS } from "./priorities.repository.js";
import {
  createPriorityRequestSchema,
  listPrioritiesQuerySchema,
  priorityIdSchema,
  reorderPrioritiesRequestSchema,
  updatePriorityRequestSchema,
} from "./priorities.schemas.js";
import type {
  CreatePriorityRequestType,
  PrioritiesRepositoryType,
  PriorityRowType,
  PriorityType,
  ReorderPrioritiesRequestType,
  UpdatePriorityRequestType,
} from "./priorities.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingPriorityId(priorityId: string): string {
  if (!priorityIdSchema.safeParse(priorityId).success) {
    throw new AppError("NOT_FOUND");
  }
  return priorityId;
}

const toPriority = (row: PriorityRowType): PriorityType => ({
  id: row.id,
  name: row.name,
  days: row.days,
  retired: row.retiredAt !== null,
});

export function createPrioritiesService({ db, repo }: { db: Db; repo: PrioritiesRepositoryType }) {
  async function loadPriority(
    executor: Executor,
    tenantId: string,
    priorityId: string,
  ): Promise<PriorityType> {
    const [row] = await repo.findById(executor, tenantId, priorityId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return toPriority(row);
  }

  /** Locks the priority; every change to one priority runs after the previous one. */
  async function lockPriority(tx: Executor, tenantId: string, priorityId: string) {
    const [row] = await repo.findByIdForUpdate(tx, tenantId, priorityId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  return {
    async list(tenantId: string, input: unknown): Promise<PageType<PriorityType>> {
      const query = validate(listPrioritiesQuerySchema, input);
      const page = await listPage({
        db,
        list: "priorities",
        query,
        keys: PRIORITY_SORT_KEYS,
        direction: "asc",
        where: ({ retired }) => repo.listWhere(tenantId, retired),
        selectPage: (tx, request) => repo.selectPage(tx, request),
        count: (tx, where) => repo.count(tx, where),
      });
      return { ...page, items: page.items.map(toPriority) };
    },

    /** Appends the priority to the end of the order (R5.12). A duplicate name reaches the error handler as PRIORITY_NAME_TAKEN. */
    create(
      tenantId: string,
      input: CreatePriorityRequestType,
      context: AuditContextType,
    ): Promise<PriorityType> {
      const body = validate(createPriorityRequestSchema, input);
      return withTx(db, async (tx) => {
        await repo.lockOrder(tx, tenantId);
        const id = randomUUID();
        await repo.insert(tx, {
          id,
          tenantId,
          name: body.name,
          days: body.days,
          sortOrder: await repo.nextPlace(tx, tenantId),
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "priority.created",
          resourceType: "priority",
          resourceId: id,
          details: { name: body.name, days: body.days },
        });
        return loadPriority(tx, tenantId, id);
      });
    },

    /** Changes the name and/or the days; a save that changes nothing writes nothing. */
    update(
      tenantId: string,
      priorityId: string,
      input: UpdatePriorityRequestType,
      context: AuditContextType,
    ): Promise<PriorityType> {
      const id = existingPriorityId(priorityId);
      const body = validate(updatePriorityRequestSchema, input);
      return withTx(db, async (tx) => {
        const priority = await lockPriority(tx, tenantId, id);
        if (priority.retiredAt) {
          throw new AppError("RESOURCE_RETIRED");
        }
        const patch: { name?: string; days?: number } = {};
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        if (body.name !== undefined && body.name !== priority.name) {
          patch.name = body.name;
          before.name = priority.name;
          after.name = body.name;
        }
        if (body.days !== undefined && body.days !== priority.days) {
          patch.days = body.days;
          before.days = priority.days;
          after.days = body.days;
        }
        if (Object.keys(patch).length === 0) {
          return toPriority(priority);
        }
        await repo.update(tx, tenantId, id, patch);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "priority.updated",
          resourceType: "priority",
          resourceId: id,
          details: { before, after },
        });
        return loadPriority(tx, tenantId, id);
      });
    },

    /**
     * Sets the display order as a whole list of the active priorities (R5.12). The order lock serializes it with
     * creates, retires, and restores, so "exactly the active priorities" cannot go stale mid-save.
     */
    reorder(
      tenantId: string,
      input: ReorderPrioritiesRequestType,
      context: AuditContextType,
    ): Promise<void> {
      const { ids } = validate(reorderPrioritiesRequestSchema, input);
      return withTx(db, async (tx) => {
        await repo.lockOrder(tx, tenantId);
        const before = await repo.activeIds(tx, tenantId);
        const sameSet =
          ids.length === before.length &&
          new Set(ids).size === ids.length &&
          before.every((id) => ids.includes(id));
        if (!sameSet) {
          throw new AppError("VALIDATION_FAILED", [{ path: "ids", code: "order_mismatch" }]);
        }
        if (ids.some((id, index) => id !== before[index])) {
          await repo.setOrder(tx, tenantId, ids);
          await writeAuditEntry(tx, {
            tenantId,
            ...context,
            action: "priority.reordered",
            resourceType: "priority",
            resourceId: tenantId,
            details: { before, after: ids },
          });
        }
      });
    },

    /** Takes the priority out of the order and hides it from new requests (R5.15). Repeating it is a no-op. */
    retire(tenantId: string, priorityId: string, context: AuditContextType): Promise<PriorityType> {
      const id = existingPriorityId(priorityId);
      return withTx(db, async (tx) => {
        await repo.lockOrder(tx, tenantId);
        const priority = await lockPriority(tx, tenantId, id);
        if (priority.retiredAt) {
          return toPriority(priority);
        }
        await repo.setRetired(tx, tenantId, id, { retired: true });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "priority.retired",
          resourceType: "priority",
          resourceId: id,
        });
        return loadPriority(tx, tenantId, id);
      });
    },

    /** Brings a retired priority back at the end of the order (R5.15); a name taken meanwhile is PRIORITY_NAME_TAKEN. */
    restore(
      tenantId: string,
      priorityId: string,
      context: AuditContextType,
    ): Promise<PriorityType> {
      const id = existingPriorityId(priorityId);
      return withTx(db, async (tx) => {
        await repo.lockOrder(tx, tenantId);
        const priority = await lockPriority(tx, tenantId, id);
        if (!priority.retiredAt) {
          return toPriority(priority);
        }
        await repo.setRetired(tx, tenantId, id, {
          retired: false,
          sortOrder: await repo.nextPlace(tx, tenantId),
        });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "priority.restored",
          resourceType: "priority",
          resourceId: id,
        });
        return loadPriority(tx, tenantId, id);
      });
    },
  };
}
