import { z } from "zod";
import {
  MAX_DISCOUNT_PERCENT,
  MAX_GRACE_DAYS,
  MAX_PLAN_NAME_LENGTH,
  MAX_PRICE_HALALAS,
  MAX_USER_LIMIT,
  PAYMENT_PERIODS,
} from "./plans.config.js";

// Two decimals at most: 12.5 and 12.34 pass, 12.345 fails. Compared in hundredths to avoid floating-point noise.
export const discountPercentSchema = z
  .number()
  .min(0)
  .max(MAX_DISCOUNT_PERCENT)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: "at most two decimals",
  });

const planFields = {
  name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH),
  userLimit: z.number().int().min(1).max(MAX_USER_LIMIT),
  graceDays: z.number().int().min(0).max(MAX_GRACE_DAYS),
  priceHalalas: z.number().int().min(0).max(MAX_PRICE_HALALAS),
  paymentPeriod: z.enum(PAYMENT_PERIODS),
  discountPercent: discountPercentSchema,
};

export const createPlanRequestSchema = z.object({
  ...planFields,
  discountPercent: planFields.discountPercent.default(0),
});

export const updatePlanRequestSchema = z
  .object(planFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "at least one field" });

export const planIdSchema = z.uuid();
