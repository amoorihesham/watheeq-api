import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { ASSIGNEE_BUILTINS } from './positions.constants.js';
import type { createPositionsController } from './positions.controller.js';
import type { createPositionsRepository } from './positions.repository.js';
import type { assigneeTargetResponseSchema, positionResponseSchema } from './positions.responses.js';
import type { assigneeTargetSchema, createPositionRequestSchema, listPositionsQuerySchema, renamePositionRequestSchema, setHoldersRequestSchema } from './positions.schemas.js';
import type { createPositionsService } from './positions.service.js';

export type AssigneeBuiltinType = (typeof ASSIGNEE_BUILTINS)[number];
export type AssigneeTargetType = z.output<typeof assigneeTargetSchema>;

/** A position row; `unitId` is null only for a retired position whose unit was deleted. */
export interface PositionRowType {
  id: string;
  unitId: string | null;
  name: string;
  retiredAt: Date | null;
}

/** One member holding a position. */
export interface HolderRowType {
  positionId: string;
  userId: string;
  name: string;
}

/** A member's placement, as the holder checks read it. */
export interface MemberStateRowType {
  userId: string;
  unitId: string | null;
  positionId: string | null;
  isActive: boolean;
}

export interface UnitRowType {
  id: string;
  kind: 'department' | 'section';
  parentId: string | null;
}

export type PositionType = z.output<typeof positionResponseSchema>;
export type AssigneeTargetResponseType = z.output<typeof assigneeTargetResponseSchema>;

export type CreatePositionRequestType = z.output<typeof createPositionRequestSchema>;
export type RenamePositionRequestType = z.output<typeof renamePositionRequestSchema>;
export type SetHoldersRequestType = z.output<typeof setHoldersRequestSchema>;
export type ListPositionsQueryType = z.output<typeof listPositionsQuerySchema>;

/** Who a request is about; the handler is unknown until acceptance (Phase 5 spec, 4.3). */
export interface AssigneeContextType {
  handlerId: string | null;
  requesterId: string;
}

export type PartyType = 'handler' | 'requester';

/**
 * One rung of the chain a stage climbs. `anchor` is the person a managers level is relative to, who is never
 * among those managers.
 */
export type AssigneeLevelType = { kind: 'position'; positionId: string } | { kind: 'person'; party: PartyType } | { kind: 'managers'; unitId: string | null; anchor?: PartyType };

export interface ResolvedAssigneesType {
  level: AssigneeLevelType;
  /** Active people who may act, ordered by id. Empty when nobody is eligible. */
  userIds: string[];
}

export interface ResolveOptionsType {
  /** The handler and the requester are never resolved (the stage's "exclude the parties" choice, R5.6). */
  excludeParties: boolean;
}

export interface PositionsRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type PositionsRepositoryType = ReturnType<typeof createPositionsRepository>;
export type PositionsServiceType = ReturnType<typeof createPositionsService>;
export type PositionsControllerType = ReturnType<typeof createPositionsController>;
