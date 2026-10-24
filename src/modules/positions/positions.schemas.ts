import { z } from "zod";
import {
  ASSIGNEE_BUILTINS,
  MAX_POSITION_HOLDERS,
  MAX_POSITION_NAME_LENGTH,
} from "./positions.config.js";

const positionName = z.string().trim().min(1).max(MAX_POSITION_NAME_LENGTH);

export const positionIdSchema = z.uuid();

export const createPositionRequestSchema = z.strictObject({
  unitId: z.uuid(),
  name: positionName,
});

export const renamePositionRequestSchema = z.strictObject({ name: positionName });

// Replaces the whole set of holders; an empty list leaves the position vacant.
export const setHoldersRequestSchema = z.strictObject({
  userIds: z.array(z.uuid()).max(MAX_POSITION_HOLDERS),
});

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listPositionsQuerySchema = z.object({
  unitId: z.uuid().optional(),
  includeRetired: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

/** What a stage or an escalation recipient points at: a tenant position or a built-in one (Phase 5 spec, 4.1). */
export const assigneeTargetSchema = z.union([
  z.strictObject({ position: z.uuid() }),
  z.strictObject({ builtin: z.enum(ASSIGNEE_BUILTINS) }),
]);
