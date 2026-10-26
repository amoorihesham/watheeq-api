import { z } from "zod";
import { booleanFilter, idFilter, pageQuery } from "@/http/filters.js";
import { idSchema } from "@/http/validate.js";
import {
  ASSIGNEE_BUILTINS,
  MAX_POSITION_HOLDERS,
  MAX_POSITION_NAME_LENGTH,
} from "./positions.config.js";

const positionName = z.string().trim().min(1).max(MAX_POSITION_NAME_LENGTH);

export const positionIdSchema = idSchema;

export const createPositionRequestSchema = z.strictObject({
  unitId: idSchema,
  name: positionName,
});

export const renamePositionRequestSchema = z.strictObject({ name: positionName });

// Replaces the whole set of holders; an empty list leaves the position vacant.
export const setHoldersRequestSchema = z.strictObject({
  userIds: z.array(idSchema).max(MAX_POSITION_HOLDERS),
});

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listPositionsQuerySchema = z.object({
  unitId: idFilter({ none: false }),
  retired: booleanFilter("false"),
  ...pageQuery,
});

/** What a stage or an escalation recipient points at: a tenant position or a built-in one (Phase 5 spec, 4.1). */
export const assigneeTargetSchema = z.union([
  z.strictObject({ position: idSchema }),
  z.strictObject({ builtin: z.enum(ASSIGNEE_BUILTINS) }),
]);
