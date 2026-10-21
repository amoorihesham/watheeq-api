import type { subscriptions } from "@/db/schema/index.js";
import type { SUBSCRIPTION_STATES } from "./subscriptions.config.js";

export type SubscriptionStateType = (typeof SUBSCRIPTION_STATES)[number];

export type SubscriptionRowType = typeof subscriptions.$inferSelect;
export type NewSubscriptionType = typeof subscriptions.$inferInsert;

export interface PricingInputType {
  priceHalalas: number;
  planDiscountPercent: number;
  customerDiscountPercent: number;
}

export interface PricingType extends PricingInputType {
  paymentPeriod: SubscriptionRowType["paymentPeriod"];
  effectivePriceHalalas: number;
}

/** A subscription as every API response shows it (R1.11). */
export interface SubscriptionViewType {
  planId: string;
  planName: string;
  userLimit: number;
  graceDays: number;
  startDate: string;
  endDate: string;
  graceEndsOn: string;
  state: SubscriptionStateType;
  pricing: PricingType;
}

export interface UsageType {
  activeUsers: number;
  userLimit: number;
  overLimit: boolean;
}
