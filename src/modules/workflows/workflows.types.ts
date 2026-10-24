import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { AssigneeBuiltinType } from "@/modules/positions/index.js";
import type { STAGE_FALLBACKS } from "./workflows.config.js";
import type { createWorkflowsController } from "./workflows.controller.js";
import type { createWorkflowsRepository } from "./workflows.repository.js";
import type {
  createWorkflowRequestSchema,
  listWorkflowsQuerySchema,
  updateWorkflowRequestSchema,
} from "./workflows.schemas.js";
import type { createWorkflowsService } from "./workflows.service.js";

export type StageFallbackType = (typeof STAGE_FALLBACKS)[number];

/** A workflow with its current version's header, without stages. */
export interface WorkflowRowType {
  id: string;
  name: string;
  retiredAt: Date | null;
  currentVersionId: string;
  versionNumber: number;
  versionCreatedAt: Date;
  versionCreatedBy: string;
}

/** A workflow row as locked for a change. */
export interface LockedWorkflowRowType {
  id: string;
  name: string;
  retiredAt: Date | null;
  currentVersionId: string;
}

export interface VersionRowType {
  id: string;
  number: number;
  createdAt: Date;
  createdBy: string;
}

export interface StageRowType {
  id: string;
  name: string;
  targetPositionId: string | null;
  targetBuiltin: AssigneeBuiltinType | null;
  /** The target position's name, when the target is one. */
  positionName: string | null;
  whenUnresolved: StageFallbackType;
  handlerMayNarrow: boolean;
  handlerMayEscalate: boolean;
  excludeParties: boolean;
}

/** A tenant position as a stage save reads it under a share lock. */
export interface PositionStateRowType {
  id: string;
  retiredAt: Date | null;
}

export type CreateWorkflowRequestType = z.input<typeof createWorkflowRequestSchema>;
export type UpdateWorkflowRequestType = z.input<typeof updateWorkflowRequestSchema>;
export type ListWorkflowsQueryType = z.output<typeof listWorkflowsQuerySchema>;
export type StageInputType = z.output<typeof createWorkflowRequestSchema>["stages"][number];

/** A stage as the API returns it; a position target carries the position's name (Phase 5 spec, 4.2). */
export interface StageType {
  id: string;
  name: string;
  assignee: { position: string; name: string | null } | { builtin: AssigneeBuiltinType };
  whenUnresolved: StageFallbackType;
  handlerMayNarrow: boolean;
  handlerMayEscalate: boolean;
  excludeParties: boolean;
}

export interface VersionHeaderType {
  number: number;
  createdAt: Date;
  createdBy: string;
}

export interface VersionType extends VersionHeaderType {
  stages: StageType[];
}

export interface WorkflowSummaryType {
  id: string;
  name: string;
  retired: boolean;
  version: VersionHeaderType;
  versionCount: number;
}

export interface WorkflowType extends Omit<WorkflowSummaryType, "version"> {
  version: VersionType;
}

export interface ListWorkflowsResponseType {
  workflows: WorkflowSummaryType[];
}
export interface WorkflowResponseType {
  workflow: WorkflowType;
}
export interface VersionResponseType {
  version: VersionType;
}

export interface WorkflowsRouterDepsType {
  db: Db;
  config: Config;
}

export type WorkflowsRepositoryType = ReturnType<typeof createWorkflowsRepository>;
export type WorkflowsServiceType = ReturnType<typeof createWorkflowsService>;
export type WorkflowsControllerType = ReturnType<typeof createWorkflowsController>;
