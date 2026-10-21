import { z } from "zod";
import { emailSchema, userNameSchema } from "@/modules/auth/index.js";
import { discountPercentSchema } from "../plans/plans.schemas.js";
import { MAX_REASON_LENGTH, MAX_TENANT_NAME_LENGTH, SLUG_PATTERN } from "./tenants.config.js";

export const createTenantRequestSchema = z.object({
  name: z.string().trim().min(1).max(MAX_TENANT_NAME_LENGTH),
  slug: z.string().regex(SLUG_PATTERN),
  admin: z.object({ email: emailSchema, userName: userNameSchema }),
  subscription: z
    .object({
      planId: z.uuid(),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
      customerDiscountPercent: discountPercentSchema.default(0),
    })
    // No minimum term (P1.21): one day is enough.
    .refine((s) => s.endDate >= s.startDate, {
      path: ["endDate"],
      message: "endDate before startDate",
    }),
});

// Renew, extend, change plan, and end early are all this one change (Phase 1 spec, 4.3).
export const changeSubscriptionRequestSchema = z
  .object({
    planId: z.uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    // Omitted keeps the tenant's current customer discount.
    customerDiscountPercent: discountPercentSchema.optional(),
    reason: z.string().trim().min(1).max(MAX_REASON_LENGTH).optional(),
  })
  .refine((s) => s.endDate >= s.startDate, {
    path: ["endDate"],
    message: "endDate before startDate",
  });

export const tenantIdSchema = z.uuid();
