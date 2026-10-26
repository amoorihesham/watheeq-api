import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import {
  positions,
  services,
  serviceWorkflows,
  workflowStages,
  workflows,
  workflowVersions,
} from "@/db/schema/index.js";
import type { PageRequestType, SortKeyType } from "@/http/list.js";
import type {
  LockedWorkflowRowType,
  PositionStateRowType,
  StageInputType,
  StageRowType,
  VersionRowType,
  WorkflowRowType,
} from "./workflows.types.js";

const workflowColumns = {
  id: workflows.id,
  name: workflows.name,
  retiredAt: workflows.retiredAt,
  currentVersionId: workflows.currentVersionId,
  versionNumber: workflowVersions.number,
  versionCreatedAt: workflowVersions.createdAt,
  versionCreatedBy: workflowVersions.createdBy,
};

const versionColumns = {
  id: workflowVersions.id,
  number: workflowVersions.number,
  createdAt: workflowVersions.createdAt,
  createdBy: workflowVersions.createdBy,
};

/** By name, then ID (T20). */
export const WORKFLOW_SORT_KEYS: SortKeyType[] = [
  { expr: byName(workflows.name), type: "text" },
  { expr: sql`${workflows.id}`, type: "uuid" },
];

const ofTenant = (tenantId: string, workflowId: string) =>
  and(eq(workflows.tenantId, tenantId), eq(workflows.id, workflowId));

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createWorkflowsRepository() {
  return {
    /** The tenant's workflows that match the `retired` filter. */
    listWhere(tenantId: string, retired: string): SQL | undefined {
      return and(
        eq(workflows.tenantId, tenantId),
        retired === "all"
          ? undefined
          : retired === "true"
            ? isNotNull(workflows.retiredAt)
            : isNull(workflows.retiredAt),
      );
    },

    selectPage(db: Executor, page: PageRequestType) {
      return db
        .select({ ...workflowColumns, sortValues: page.sortValues })
        .from(workflows)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db.select({ total: count() }).from(workflows).where(where);
      return Number(row?.total ?? 0);
    },

    findById(db: Executor, tenantId: string, workflowId: string): Promise<WorkflowRowType[]> {
      return db
        .select(workflowColumns)
        .from(workflows)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
        .where(ofTenant(tenantId, workflowId));
    },

    /** Locks the workflow, so saves, retiring, and restoring of it run one after the other (Phase 5 spec, 4.3). */
    findByIdForUpdate(
      db: Executor,
      tenantId: string,
      workflowId: string,
    ): Promise<LockedWorkflowRowType[]> {
      return db
        .select({
          id: workflows.id,
          name: workflows.name,
          retiredAt: workflows.retiredAt,
          currentVersionId: workflows.currentVersionId,
        })
        .from(workflows)
        .where(ofTenant(tenantId, workflowId))
        .for("update");
    },

    versionById(db: Executor, tenantId: string, versionId: string): Promise<VersionRowType[]> {
      return db
        .select(versionColumns)
        .from(workflowVersions)
        .where(and(eq(workflowVersions.tenantId, tenantId), eq(workflowVersions.id, versionId)));
    },

    versionByNumber(
      db: Executor,
      tenantId: string,
      workflowId: string,
      number: number,
    ): Promise<VersionRowType[]> {
      return db
        .select(versionColumns)
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.tenantId, tenantId),
            eq(workflowVersions.workflowId, workflowId),
            eq(workflowVersions.number, number),
          ),
        );
    },

    /** The stages of one version, in order, with the names of the positions they name. */
    stagesOfVersion(db: Executor, tenantId: string, versionId: string): Promise<StageRowType[]> {
      return db
        .select({
          id: workflowStages.id,
          name: workflowStages.name,
          targetPositionId: workflowStages.targetPositionId,
          targetBuiltin: workflowStages.targetBuiltin,
          positionName: positions.name,
          whenUnresolved: workflowStages.whenUnresolved,
          handlerMayNarrow: workflowStages.handlerMayNarrow,
          handlerMayEscalate: workflowStages.handlerMayEscalate,
          excludeParties: workflowStages.excludeParties,
        })
        .from(workflowStages)
        .leftJoin(
          positions,
          and(
            eq(positions.tenantId, workflowStages.tenantId),
            eq(positions.id, workflowStages.targetPositionId),
          ),
        )
        .where(and(eq(workflowStages.tenantId, tenantId), eq(workflowStages.versionId, versionId)))
        .orderBy(asc(workflowStages.ordinal));
    },

    /**
     * Locks the named positions against retiring (`FOR SHARE` pairs with the retire's `FOR UPDATE`) and returns
     * their state; a missing or foreign id is absent from the result. Ordered by id so two saves cannot deadlock.
     */
    lockPositions(
      db: Executor,
      tenantId: string,
      positionIds: string[],
    ): Promise<PositionStateRowType[]> {
      return db
        .select({ id: positions.id, retiredAt: positions.retiredAt })
        .from(positions)
        .where(and(eq(positions.tenantId, tenantId), inArray(positions.id, positionIds)))
        .orderBy(positions.id)
        .for("share");
    },

    /** The active services that allow the workflow; any of them makes retiring it refuse (R5.16). */
    allowedByActiveService(
      db: Executor,
      tenantId: string,
      workflowId: string,
    ): Promise<{ id: string }[]> {
      return db
        .select({ id: services.id })
        .from(serviceWorkflows)
        .innerJoin(
          services,
          and(
            eq(services.tenantId, serviceWorkflows.tenantId),
            eq(services.id, serviceWorkflows.serviceId),
          ),
        )
        .where(
          and(
            eq(serviceWorkflows.tenantId, tenantId),
            eq(serviceWorkflows.workflowId, workflowId),
            isNull(services.retiredAt),
          ),
        );
    },

    insertWorkflow(
      db: Executor,
      values: { id: string; tenantId: string; name: string; currentVersionId: string },
    ) {
      return db.insert(workflows).values(values);
    },

    insertVersion(
      db: Executor,
      values: {
        id: string;
        tenantId: string;
        workflowId: string;
        number: number;
        createdBy: string;
      },
    ) {
      return db.insert(workflowVersions).values(values);
    },

    insertStages(db: Executor, tenantId: string, versionId: string, stages: StageInputType[]) {
      return db.insert(workflowStages).values(
        stages.map((stage, index) => ({
          tenantId,
          versionId,
          ordinal: index + 1,
          name: stage.name,
          targetPositionId: "position" in stage.assignee ? stage.assignee.position : null,
          targetBuiltin: "builtin" in stage.assignee ? stage.assignee.builtin : null,
          whenUnresolved: stage.whenUnresolved,
          handlerMayNarrow: stage.handlerMayNarrow,
          handlerMayEscalate: stage.handlerMayEscalate,
          excludeParties: stage.excludeParties,
        })),
      );
    },

    /** Renames the workflow and/or points it at a newer version. */
    update(
      db: Executor,
      tenantId: string,
      workflowId: string,
      patch: { name?: string; currentVersionId?: string },
    ) {
      return db
        .update(workflows)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, workflowId));
    },

    setRetired(db: Executor, tenantId: string, workflowId: string, retired: boolean) {
      return db
        .update(workflows)
        .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()` })
        .where(ofTenant(tenantId, workflowId));
    },
  };
}
