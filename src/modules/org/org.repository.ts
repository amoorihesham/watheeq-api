import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { orgUnits, positions, tenantMembers, users } from "@/db/schema/index.js";
import type { NewOrgUnitType, OrgUnitType, UnitChangesType } from "./org.types.js";

const unitColumns = {
  id: orgUnits.id,
  kind: orgUnits.kind,
  parentId: orgUnits.parentId,
  name: orgUnits.name,
  createdAt: orgUnits.createdAt,
  updatedAt: orgUnits.updatedAt,
};

const ofTenant = (tenantId: string, unitId: string) =>
  and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId));

export function createOrgRepository() {
  return {
    insert(db: Executor, values: NewOrgUnitType): Promise<OrgUnitType[]> {
      return db.insert(orgUnits).values(values).returning(unitColumns);
    },

    listUnits(db: Executor, tenantId: string): Promise<OrgUnitType[]> {
      return db
        .select(unitColumns)
        .from(orgUnits)
        .where(eq(orgUnits.tenantId, tenantId))
        .orderBy(byName(orgUnits.name));
    },

    /** Member counts per unit; the row with a null `unitId` counts members at the organization level. */
    countMembersByUnit(
      db: Executor,
      tenantId: string,
    ): Promise<{ unitId: string | null; memberCount: number }[]> {
      return db
        .select({ unitId: tenantMembers.unitId, memberCount: count() })
        .from(tenantMembers)
        .where(eq(tenantMembers.tenantId, tenantId))
        .groupBy(tenantMembers.unitId);
    },

    /** Active managers of every unit, ordered by name (P2.3). */
    listManagers(
      db: Executor,
      tenantId: string,
    ): Promise<{ unitId: string | null; id: string; userName: string }[]> {
      return db
        .select({ unitId: tenantMembers.unitId, id: users.id, userName: users.userName })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.isManager, true),
            eq(users.isActive, true),
          ),
        )
        .orderBy(byName(users.userName), users.id);
    },

    findById(db: Executor, tenantId: string, unitId: string): Promise<OrgUnitType[]> {
      return db.select(unitColumns).from(orgUnits).where(ofTenant(tenantId, unitId));
    },

    /**
     * Locks the unit. A concurrent insert of a section or member into it checks its foreign key with a key-share
     * lock, which waits for this one, so an emptiness check made after this sees every committed child.
     */
    findByIdForUpdate(db: Executor, tenantId: string, unitId: string): Promise<OrgUnitType[]> {
      return db.select(unitColumns).from(orgUnits).where(ofTenant(tenantId, unitId)).for("update");
    },

    countSections(db: Executor, tenantId: string, unitId: string): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(orgUnits)
        .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.parentId, unitId)));
    },

    countMembers(db: Executor, tenantId: string, unitId: string): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.unitId, unitId)));
    },

    countActivePositions(
      db: Executor,
      tenantId: string,
      unitId: string,
    ): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(positions)
        .where(
          and(
            eq(positions.tenantId, tenantId),
            eq(positions.unitId, unitId),
            isNull(positions.retiredAt),
          ),
        );
    },

    /** Retired positions outlive their unit with no unit, and can no longer be restored (Phase 5 spec, 4.3). */
    detachRetiredPositions(db: Executor, tenantId: string, unitId: string) {
      return db
        .update(positions)
        .set({ unitId: null })
        .where(
          and(
            eq(positions.tenantId, tenantId),
            eq(positions.unitId, unitId),
            isNotNull(positions.retiredAt),
          ),
        );
    },

    update(
      db: Executor,
      tenantId: string,
      unitId: string,
      changes: UnitChangesType,
    ): Promise<OrgUnitType[]> {
      return db
        .update(orgUnits)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, unitId))
        .returning(unitColumns);
    },

    delete(db: Executor, tenantId: string, unitId: string) {
      return db.delete(orgUnits).where(ofTenant(tenantId, unitId));
    },
  };
}
