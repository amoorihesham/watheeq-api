import { z } from 'zod';

export const healthResponseSchema = z
  .strictObject({
    status: z.literal('ok'),
    db: z.literal('up'),
  })
  .meta({ id: 'Health' });
