import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { AssigneeBuiltinType } from "@/modules/positions/index.js";
import type { STAGE_FALLBACKS } from "./workflows.config.js";
import type { createWorkflowsController } from "./workflows.controller.js";
import type { createWorkflowsRepository } from "./workflows.repository.js";
import type {
  versionResponseSchema,
  workflowResponseSchema,
  workflowSummaryResponseSchema,
} from "./workflows.responses.js";
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

export type StageType = z.output<typeof versionResponseSchema>["stages"][number];
export type VersionType = z.output<typeof versionResponseSchema>;
export type WorkflowSummaryType = z.output<typeof workflowSummaryResponseSchema>;
export type WorkflowType = z.output<typeof workflowResponseSchema>;

export interface WorkflowsRouterDepsType {
  db: Db;
  config: Config;
}

export type WorkflowsRepositoryType = ReturnType<typeof createWorkflowsRepository>;
export type WorkflowsServiceType = ReturnType<typeof createWorkflowsService>;
export type WorkflowsControllerType = ReturnType<typeof createWorkflowsController>;
