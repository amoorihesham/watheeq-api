import { z } from 'zod';
import { booleanFilter, pageQuery } from '@/http/filters.js';
import { NO_FIELDS } from '@/http/validate.js';
import { MAX_PRIORITY_DAYS, MAX_PRIORITY_NAME_LENGTH, MIN_PRIORITY_DAYS } from './priorities.constants.js';

const priorityName = z.string().trim().min(1).max(MAX_PRIORITY_NAME_LENGTH);
const days = z.int().min(MIN_PRIORITY_DAYS).max(MAX_PRIORITY_DAYS);

export const createPriorityRequestSchema = z.strictObject({ name: priorityName, days }).meta({ id: 'CreatePriorityRequest' });

export const updatePriorityRequestSchema = z
  .strictObject({ name: priorityName, days })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS)
  .meta({ id: 'UpdatePriorityRequest' });

// The list itself is checked against the active priorities (`order_mismatch`).
export const reorderPrioritiesRequestSchema = z.strictObject({ ids: z.array(z.string()) }).meta({ id: 'ReorderPrioritiesRequest' });

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listPrioritiesQuerySchema = z.object({
  retired: booleanFilter('false'),
  ...pageQuery,
});
