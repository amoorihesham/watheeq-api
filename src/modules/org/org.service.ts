import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import { createUnitRequestSchema, unitIdSchema, updateUnitRequestSchema } from "./org.schemas.js";
import type {
  CreateUnitRequestType,
  GetOrgTreeResponseType,
  OrgRepositoryType,
  OrgUnitType,
  UpdateUnitRequestType,
} from "./org.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingUnitId(unitId: string): string {
  if (!unitIdSchema.safeParse(unitId).success) {
    throw new AppError("NOT_FOUND");
  }
  return unitId;
}

const invalidParent = (code: string) =>
  new AppError("VALIDATION_FAILED", [{ path: "parentId", code }]);

const auditDetailsOf = (unit: OrgUnitType) => ({
  name: unit.name,
  kind: unit.kind,
  parentId: unit.parentId,
});

export function createOrgService({ db, repo }: { db: Db; repo: OrgRepositoryType }) {
  /** A section's parent must be a department of the same tenant (R2.2); `kind` never changes, so this cannot race. */
  async function assertDepartment(executor: Executor, tenantId: string, parentId: string) {
    const [parent] = await repo.findById(executor, tenantId, parentId);
    if (!parent) {
      throw invalidParent("unknown_unit");
    }
    if (parent.kind !== "department") {
      throw invalidParent("parent_not_department");
    }
  }

  return {
    async tree(tenantId: string): Promise<GetOrgTreeResponseType> {
      const [units, counts] = await Promise.all([
        repo.listUnits(db, tenantId),
        repo.countMembersByUnit(db, tenantId),
      ]);
      const memberCount = new Map(counts.map((row) => [row.unitId, row.memberCount]));
      const node = (unit: OrgUnitType) => ({
        id: unit.id,
        name: unit.name,
        memberCount: memberCount.get(unit.id) ?? 0,
      });
      return {
        organization: { memberCount: memberCount.get(null) ?? 0 },
        departments: units
          .filter((unit) => unit.kind === "department")
          .map((department) => ({
            ...node(department),
            sections: units.filter((unit) => unit.parentId === department.id).map(node),
          })),
      };
    },

    /** A duplicate sibling name (any case) reaches the error handler as UNIT_NAME_TAKEN (R2.3). */
    create(
      tenantId: string,
      input: CreateUnitRequestType,
      context: AuditContextType,
    ): Promise<OrgUnitType> {
      const { name, parentId } = validate(createUnitRequestSchema, input);
      return withTx(db, async (tx) => {
        if (parentId) {
          await assertDepartment(tx, tenantId, parentId);
        }
        const [unit] = await repo.insert(tx, {
          tenantId,
          kind: parentId ? "section" : "department",
          parentId: parentId ?? null,
          name,
        });
        if (!unit) {
          throw new Error("insert returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "org_unit.created",
          resourceType: "org_unit",
          resourceId: unit.id,
          details: auditDetailsOf(unit),
        });
        return unit;
      });
    },

    /** Renames a unit or moves a section to another department (R2.4). */
    update(
      tenantId: string,
      unitId: string,
      input: UpdateUnitRequestType,
      context: AuditContextType,
    ): Promise<OrgUnitType> {
      const id = existingUnitId(unitId);
      const changes = validate(updateUnitRequestSchema, input);
      return withTx(db, async (tx) => {
        const [before] = await repo.findByIdForUpdate(tx, tenantId, id);
        if (!before) {
          throw new AppError("NOT_FOUND");
        }
        if (changes.parentId !== undefined) {
          if (before.kind === "department") {
            throw invalidParent("department_has_no_parent");
          }
          await assertDepartment(tx, tenantId, changes.parentId);
        }
        const [after] = await repo.update(tx, tenantId, id, changes);
        if (!after) {
          throw new Error("update returned no row");
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "org_unit.updated",
          resourceType: "org_unit",
          resourceId: id,
          details: {
            before: { name: before.name, parentId: before.parentId },
            after: { name: after.name, parentId: after.parentId },
          },
        });
        return after;
      });
    },

    /** Deletes a unit with no sections and no members (R2.5). The lock makes the check hold under concurrency. */
    delete(tenantId: string, unitId: string, context: AuditContextType): Promise<void> {
      const id = existingUnitId(unitId);
      return withTx(db, async (tx) => {
        const [unit] = await repo.findByIdForUpdate(tx, tenantId, id);
        if (!unit) {
          throw new AppError("NOT_FOUND");
        }
        const [sections] = await repo.countSections(tx, tenantId, id);
        const [members] = await repo.countMembers(tx, tenantId, id);
        if ((sections?.total ?? 0) > 0 || (members?.total ?? 0) > 0) {
          throw new AppError("UNIT_NOT_EMPTY");
        }
        await repo.delete(tx, tenantId, id);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "org_unit.deleted",
          resourceType: "org_unit",
          resourceId: id,
          details: auditDetailsOf(unit),
        });
      });
    },
  };
}
