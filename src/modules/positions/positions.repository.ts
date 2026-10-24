import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import {
  escalationRecipients,
  orgUnits,
  positions,
  tenantMembers,
  users,
  workflowStages,
  workflows,
} from "@/db/schema/index.js";
import type {
  HolderRowType,
  MemberStateRowType,
  PositionRowType,
  UnitRowType,
} from "./positions.types.js";

const positionColumns = {
  id: positions.id,
  unitId: positions.unitId,
  name: positions.name,
  retiredAt: positions.retiredAt,
};

const ofTenant = (tenantId: string, positionId: string) =>
  and(eq(positions.tenantId, tenantId), eq(positions.id, positionId));

/** Active members of the tenant, so a deactivated person is never resolved or counted. */
const activeMember = (tenantId: string) =>
  and(eq(tenantMembers.tenantId, tenantId), eq(users.isActive, true));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createPositionsRepository() {
  return {
    list(
      db: Executor,
      tenantId: string,
      filter: { unitId?: string | undefined; includeRetired: boolean },
    ): Promise<PositionRowType[]> {
      return db
        .select(positionColumns)
        .from(positions)
        .where(
          and(
            eq(positions.tenantId, tenantId),
            filter.unitId ? eq(positions.unitId, filter.unitId) : undefined,
            filter.includeRetired ? undefined : isNull(positions.retiredAt),
          ),
        )
        .orderBy(byName(positions.name), positions.id);
    },

    findById(db: Executor, tenantId: string, positionId: string): Promise<PositionRowType[]> {
      return db.select(positionColumns).from(positions).where(ofTenant(tenantId, positionId));
    },

    /** Locks the position, so renames, holder changes, retiring, and restoring of it run one after the other. */
    findByIdForUpdate(
      db: Executor,
      tenantId: string,
      positionId: string,
    ): Promise<PositionRowType[]> {
      return db
        .select(positionColumns)
        .from(positions)
        .where(ofTenant(tenantId, positionId))
        .for("update");
    },

    /** Stages naming the position in the current version of an active workflow; older versions do not count. */
    namedByActiveWorkflow(
      db: Executor,
      tenantId: string,
      positionId: string,
    ): Promise<{ id: string }[]> {
      return db
        .select({ id: workflowStages.id })
        .from(workflowStages)
        .innerJoin(
          workflows,
          and(
            eq(workflows.tenantId, workflowStages.tenantId),
            eq(workflows.currentVersionId, workflowStages.versionId),
          ),
        )
        .where(
          and(
            eq(workflowStages.tenantId, tenantId),
            eq(workflowStages.targetPositionId, positionId),
            isNull(workflows.retiredAt),
          ),
        )
        .limit(1);
    },

    /** Escalation recipients naming the position, whether or not the rule is on: its recipients are kept. */
    namedByEscalation(
      db: Executor,
      tenantId: string,
      positionId: string,
    ): Promise<{ rule: string }[]> {
      return db
        .select({ rule: escalationRecipients.rule })
        .from(escalationRecipients)
        .where(
          and(
            eq(escalationRecipients.tenantId, tenantId),
            eq(escalationRecipients.targetPositionId, positionId),
          ),
        )
        .limit(1);
    },

    findUnit(db: Executor, tenantId: string, unitId: string): Promise<UnitRowType[]> {
      return db
        .select({ id: orgUnits.id, kind: orgUnits.kind, parentId: orgUnits.parentId })
        .from(orgUnits)
        .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)));
    },

    /**
     * Takes a key-share lock on the unit, as a position insert does through its foreign key: a concurrent unit
     * delete waits for this transaction, then sees the position it restored.
     */
    lockUnitForShare(db: Executor, tenantId: string, unitId: string): Promise<{ id: string }[]> {
      return db
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)))
        .for("key share");
    },

    /** Holders of positions, by name; one position's, or every position's of the tenant. */
    listHolders(db: Executor, tenantId: string, positionId?: string): Promise<HolderRowType[]> {
      return db
        .select({
          positionId: sql<string>`${tenantMembers.positionId}`,
          userId: users.id,
          name: users.userName,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            positionId
              ? eq(tenantMembers.positionId, positionId)
              : isNotNull(tenantMembers.positionId),
          ),
        )
        .orderBy(byName(users.userName), users.id);
    },

    insert(
      db: Executor,
      values: { tenantId: string; unitId: string; name: string },
    ): Promise<PositionRowType[]> {
      return db.insert(positions).values(values).returning(positionColumns);
    },

    rename(
      db: Executor,
      tenantId: string,
      positionId: string,
      name: string,
    ): Promise<PositionRowType[]> {
      return db
        .update(positions)
        .set({ name, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, positionId))
        .returning(positionColumns);
    },

    setRetired(
      db: Executor,
      tenantId: string,
      positionId: string,
      retired: boolean,
    ): Promise<PositionRowType[]> {
      return db
        .update(positions)
        .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, positionId))
        .returning(positionColumns);
    },

    /** Locks the memberships, so a move or a deactivation of one of them waits for the holder change. */
    lockMembers(db: Executor, tenantId: string, userIds: string[]): Promise<{ userId: string }[]> {
      if (userIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, userIds)))
        .for("update");
    },

    memberStates(db: Executor, tenantId: string, userIds: string[]): Promise<MemberStateRowType[]> {
      if (userIds.length === 0) {
        return Promise.resolve([]);
      }
      return db
        .select({
          userId: tenantMembers.userId,
          unitId: tenantMembers.unitId,
          positionId: tenantMembers.positionId,
          isActive: users.isActive,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, userIds)));
    },

    assign(db: Executor, tenantId: string, positionId: string, userIds: string[]) {
      return db
        .update(tenantMembers)
        .set({ positionId })
        .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, userIds)));
    },

    /** Removes the position from every holder except `keep`; returns who lost it. */
    release(
      db: Executor,
      tenantId: string,
      positionId: string,
      keep: string[],
    ): Promise<{ userId: string }[]> {
      return db
        .update(tenantMembers)
        .set({ positionId: null })
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.positionId, positionId),
            keep.length > 0 ? notInArray(tenantMembers.userId, keep) : undefined,
          ),
        )
        .returning({ userId: tenantMembers.userId });
    },

    /** The unit a member sits in, or null when they sit directly under the organization or are unknown. */
    unitOfMember(
      db: Executor,
      tenantId: string,
      userId: string,
    ): Promise<{ unitId: string | null }[]> {
      return db
        .select({ unitId: tenantMembers.unitId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },

    /** The active holders of a position, except `excluded`, ordered by id. */
    holdersOf(
      db: Executor,
      tenantId: string,
      positionId: string,
      excluded: string[],
    ): Promise<{ userId: string }[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            activeMember(tenantId),
            eq(tenantMembers.positionId, positionId),
            excluded.length > 0 ? notInArray(tenantMembers.userId, excluded) : undefined,
          ),
        )
        .orderBy(tenantMembers.userId);
    },

    /** The member, if active and not in `excluded`. */
    activePerson(
      db: Executor,
      tenantId: string,
      userId: string,
      excluded: string[],
    ): Promise<{ userId: string }[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            activeMember(tenantId),
            eq(tenantMembers.userId, userId),
            excluded.length > 0 ? notInArray(tenantMembers.userId, excluded) : undefined,
          ),
        );
    },

    /** The active managers of a unit, except `excluded`, ordered by id. */
    managersOf(
      db: Executor,
      tenantId: string,
      unitId: string,
      excluded: string[],
    ): Promise<{ userId: string }[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(
          and(
            activeMember(tenantId),
            eq(tenantMembers.unitId, unitId),
            eq(tenantMembers.isManager, true),
            excluded.length > 0 ? notInArray(tenantMembers.userId, excluded) : undefined,
          ),
        )
        .orderBy(tenantMembers.userId);
    },
  };
}
