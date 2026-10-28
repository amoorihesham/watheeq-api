import { z } from 'zod';

export const priorityResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    days: z.number(),
    retired: z.boolean(),
  })
  .meta({ id: 'Priority' });
