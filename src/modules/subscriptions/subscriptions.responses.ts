import { z } from 'zod';
import { SUBSCRIPTION_STATES } from './subscriptions.constants.js';

const subscriptionState = z.enum(SUBSCRIPTION_STATES);

export const pricingResponseSchema = z
  .strictObject({
    priceHalalas: z.number(),
    paymentPeriod: z.enum(['monthly', 'yearly']),
    planDiscountPercent: z.number(),
    customerDiscountPercent: z.number(),
    effectivePriceHalalas: z.number(),
  })
  .meta({ id: 'Pricing' });

/** A subscription as every API response shows it (R1.11). */
export const subscriptionViewResponseSchema = z
  .strictObject({
    planId: z.string(),
    planName: z.string(),
    userLimit: z.number(),
    storageLimitGb: z.number(),
    graceDays: z.number(),
    startDate: z.string(),
    endDate: z.string(),
    graceEndsOn: z.string(),
    state: subscriptionState,
    pricing: pricingResponseSchema,
  })
  .meta({ id: 'SubscriptionView' });

/** What every tenant user sees about the subscription in `/auth/me`, so the client can explain disabled actions. */
export const subscriptionStatusResponseSchema = z
  .strictObject({
    state: subscriptionState,
    endDate: z.string(),
    graceEndsOn: z.string(),
  })
  .meta({ id: 'SubscriptionStatus' });

export const usageResponseSchema = z
  .strictObject({
    activeUsers: z.number(),
    userLimit: z.number(),
    overLimit: z.boolean(),
    storage: z.strictObject({
      usedBytes: z.number(),
      limitBytes: z.number(),
      overLimit: z.boolean(),
    }),
  })
  .meta({ id: 'SubscriptionUsage' });

export const getSubscriptionResponseSchema = z
  .strictObject({
    subscription: subscriptionViewResponseSchema,
    usage: usageResponseSchema,
  })
  .meta({ id: 'TenantSubscription' });
