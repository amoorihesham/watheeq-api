import { z } from 'zod';
import { ASSIGNEE_BUILTINS } from './positions.constants.js';

export const positionResponseSchema = z
  .strictObject({
    id: z.string(),
    unitId: z.string().nullable(),
    name: z.string(),
    retired: z.boolean(),
    holders: z.array(z.strictObject({ userId: z.string(), name: z.string() })),
  })
  .meta({ id: 'Position' });

/**
 * What a stage or an escalation recipient points at, as the API returns it: a position (with its name) or a
 * built-in one. Both variants carry the same keys (R8.4); the other variant's keys are `null`.
 */
export const assigneeTargetResponseSchema = z
  .strictObject({
    position: z.string().nullable(),
    name: z.string().nullable(),
    builtin: z.enum(ASSIGNEE_BUILTINS).nullable(),
  })
  .meta({ id: 'AssigneeTarget' });
