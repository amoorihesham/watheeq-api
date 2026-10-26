import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { listPage } from "@/http/list.js";
import type { PageType } from "@/http/respond.js";
import { validate } from "@/http/validate.js";
import { POSITION_SORT_KEYS } from "./positions.repository.js";
import {
  createPositionRequestSchema,
  listPositionsQuerySchema,
  positionIdSchema,
  renamePositionRequestSchema,
  setHoldersRequestSchema,
} from "./positions.schemas.js";
import type {
  CreatePositionRequestType,
  HolderRowType,
  PositionRowType,
  PositionsRepositoryType,
  PositionType,
  RenamePositionRequestType,
  SetHoldersRequestType,
} from "./positions.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingPositionId(positionId: string): string {
  if (!positionIdSchema.safeParse(positionId).success) {
    throw new AppError("NOT_FOUND");
  }
  return positionId;
}

const toPosition = (row: PositionRowType, holders: HolderRowType[]): PositionType => ({
  id: row.id,
  unitId: row.unitId,
  name: row.name,
  retired: row.retiredAt !== null,
  holders: holders
    .filter((holder) => holder.positionId === row.id)
    .map(({ userId, name }) => ({ userId, name })),
});

const sorted = (ids: string[]) => [...ids].sort();

export function createPositionsService({ db, repo }: { db: Db; repo: PositionsRepositoryType }) {
  async function loadPosition(executor: Executor, tenantId: string, positionId: string) {
    const [row] = await repo.findById(executor, tenantId, positionId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return toPosition(row, await repo.listHolders(executor, tenantId, positionId));
  }

  /** Locks the position; every change to one position runs after the previous one. */
  async function lockPosition(tx: Executor, tenantId: string, positionId: string) {
    const [row] = await repo.findByIdForUpdate(tx, tenantId, positionId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  const assertActive = (row: PositionRowType) => {
    if (row.retiredAt) {
      throw new AppError("RESOURCE_RETIRED");
    }
  };

  return {
    async list(tenantId: string, input: unknown): Promise<PageType<PositionType>> {
      const query = validate(listPositionsQuerySchema, input);
      const page = await listPage({
        db,
        list: "positions",
        query,
        keys: POSITION_SORT_KEYS,
        direction: "asc",
        where: (filters) => repo.listWhere(tenantId, filters),
        selectPage: (tx, request) => repo.selectPage(tx, request),
        count: (tx, where) => repo.count(tx, where),
      });
      const holders = await repo.listHolders(db, tenantId);
      return { ...page, items: page.items.map((row) => toPosition(row, holders)) };
    },

    get(tenantId: string, positionId: string): Promise<PositionType> {
      return loadPosition(db, tenantId, existingPositionId(positionId));
    },

    /** A duplicate name (any case) among active positions reaches the error handler as POSITION_NAME_TAKEN (R5.1). */
    create(
      tenantId: string,
      input: CreatePositionRequestType,
      context: AuditContextType,
    ): Promise<PositionType> {
      const body = validate(createPositionRequestSchema, input);
      return withTx(db, async (tx) => {
        if (!(await repo.findUnit(tx, tenantId, body.unitId)).length) {
          throw new AppError("VALIDATION_FAILED", [{ path: "unitId", code: "unknown_unit" }]);
        }
        const [row] = await repo.insert(tx, { tenantId, unitId: body.unitId, name: body.name });
        if (!row) {
          throw new Error("insert returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "position.created",
          resourceType: "position",
          resourceId: row.id,
          details: { name: row.name, unitId: row.unitId },
        });
        return toPosition(row, []);
      });
    },

    rename(
      tenantId: string,
      positionId: string,
      input: RenamePositionRequestType,
      context: AuditContextType,
    ): Promise<PositionType> {
      const id = existingPositionId(positionId);
      const { name } = validate(renamePositionRequestSchema, input);
      return withTx(db, async (tx) => {
        const before = await lockPosition(tx, tenantId, id);
        assertActive(before);
        if (name === before.name) {
          return loadPosition(tx, tenantId, id);
        }
        await repo.rename(tx, tenantId, id, name);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "position.updated",
          resourceType: "position",
          resourceId: id,
          details: { before: { name: before.name }, after: { name } },
        });
        return loadPosition(tx, tenantId, id);
      });
    },

    /**
     * Replaces the position's holders (R5.2). The memberships are locked before they are read, so a concurrent
     * deactivation is seen; a concurrent move is refused by the holder foreign key (R5.3).
     */
    setHolders(
      tenantId: string,
      positionId: string,
      input: SetHoldersRequestType,
      context: AuditContextType,
    ): Promise<PositionType> {
      const id = existingPositionId(positionId);
      const { userIds } = validate(setHoldersRequestSchema, input);
      const wanted = [...new Set(userIds)];
      return withTx(db, async (tx) => {
        const position = await lockPosition(tx, tenantId, id);
        assertActive(position);
        await repo.lockMembers(tx, tenantId, wanted);
        const states = new Map(
          (await repo.memberStates(tx, tenantId, wanted)).map((state) => [state.userId, state]),
        );
        const details: ErrorDetail[] = [];
        wanted.forEach((userId, index) => {
          const state = states.get(userId);
          const path = `userIds.${index}`;
          if (!state || state.unitId !== position.unitId) {
            details.push({ path, code: "not_unit_member" });
          } else if (!state.isActive) {
            details.push({ path, code: "user_inactive" });
          } else if (state.positionId && state.positionId !== id) {
            details.push({ path, code: "holds_other_position" });
          }
        });
        if (details.length > 0) {
          throw new AppError("VALIDATION_FAILED", details);
        }

        const before = sorted(
          (await repo.listHolders(tx, tenantId, id)).map((holder) => holder.userId),
        );
        const after = sorted(wanted);
        if (JSON.stringify(before) === JSON.stringify(after)) {
          return loadPosition(tx, tenantId, id);
        }
        await repo.release(tx, tenantId, id, wanted);
        if (wanted.length > 0) {
          await repo.assign(tx, tenantId, id, wanted);
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "position.holders_set",
          resourceType: "position",
          resourceId: id,
          details: { before, after },
        });
        return loadPosition(tx, tenantId, id);
      });
    },

    /** Hides the position from new use and removes its holders (R5.15, R5.16). Repeating it is a no-op. */
    retire(tenantId: string, positionId: string, context: AuditContextType): Promise<PositionType> {
      const id = existingPositionId(positionId);
      return withTx(db, async (tx) => {
        const position = await lockPosition(tx, tenantId, id);
        if (position.retiredAt) {
          return loadPosition(tx, tenantId, id);
        }
        // The lock above pairs with the share lock a workflow or escalation save takes, so these checks cannot
        // miss a save in flight (R5.16).
        if (
          (await repo.namedByActiveWorkflow(tx, tenantId, id)).length > 0 ||
          (await repo.namedByEscalation(tx, tenantId, id)).length > 0
        ) {
          throw new AppError("POSITION_IN_USE");
        }
        const removed = await repo.release(tx, tenantId, id, []);
        await repo.setRetired(tx, tenantId, id, true);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "position.retired",
          resourceType: "position",
          resourceId: id,
          details: { removedHolders: sorted(removed.map((holder) => holder.userId)) },
        });
        return loadPosition(tx, tenantId, id);
      });
    },

    /** Brings a retired position back, vacant (R5.15). Repeating it is a no-op. */
    restore(
      tenantId: string,
      positionId: string,
      context: AuditContextType,
    ): Promise<PositionType> {
      const id = existingPositionId(positionId);
      return withTx(db, async (tx) => {
        // The unit is locked before the position, the order a unit delete takes them in, so the two cannot deadlock.
        const [peek] = await repo.findById(tx, tenantId, id);
        if (peek?.unitId) {
          await repo.lockUnitForShare(tx, tenantId, peek.unitId);
        }
        const position = await lockPosition(tx, tenantId, id);
        if (!position.retiredAt) {
          return loadPosition(tx, tenantId, id);
        }
        if (!position.unitId) {
          throw new AppError("POSITION_UNIT_GONE");
        }
        await repo.setRetired(tx, tenantId, id, false);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "position.restored",
          resourceType: "position",
          resourceId: id,
        });
        return loadPosition(tx, tenantId, id);
      });
    },
  };
}
