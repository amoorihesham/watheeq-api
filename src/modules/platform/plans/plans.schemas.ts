import { z } from "zod";
import { idSchema, NO_FIELDS } from "@/http/validate.js";
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
    params: { code: "too_many_decimals" },
  });

const planFields = {
  name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH),
  userLimit: z.number().int().min(1).max(MAX_USER_LIMIT),
  graceDays: z.number().int().min(0).max(MAX_GRACE_DAYS),
  priceHalalas: z.number().int().min(0).max(MAX_PRICE_HALALAS),
  paymentPeriod: z.enum(PAYMENT_PERIODS),
  discountPercent: discountPercentSchema,
};

export const createPlanRequestSchema = z.strictObject({
  ...planFields,
  discountPercent: planFields.discountPercent.default(0),
});

export const updatePlanRequestSchema = z
  .strictObject(planFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

export const planIdSchema = idSchema;
