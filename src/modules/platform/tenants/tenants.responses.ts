import { z } from "zod";
import {
  subscriptionViewResponseSchema,
  usageResponseSchema,
} from "@/modules/subscriptions/index.js";

export const tenantResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string().nullable(),
  createdAt: z.date(),
});

/** The one tenant shape: create, get, each list item, and a subscription change all answer it (Q18). */
export const tenantDetailResponseSchema = z.strictObject({
  tenant: tenantResponseSchema,
  subscription: subscriptionViewResponseSchema,
  usage: usageResponseSchema,
});
