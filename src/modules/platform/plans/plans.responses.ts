import { z } from 'zod';
import { PAYMENT_PERIODS } from './plans.constants.js';

export const planResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    userLimit: z.number(),
    storageLimitGb: z.number(),
    graceDays: z.number(),
    priceHalalas: z.number(),
    paymentPeriod: z.enum(PAYMENT_PERIODS),
    discountPercent: z.number(),
    /** `priceHalalas` after `discountPercent`, rounded half up to the halala; computed, never stored (R11.8). */
    discountedPriceHalalas: z.number(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .meta({ id: 'Plan' });
