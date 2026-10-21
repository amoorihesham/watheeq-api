import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { subscriptions } from "@/db/schema/index.js";
import type { SUBSCRIPTION_STATES } from "./subscriptions.config.js";
import type { createSubscriptionsController } from "./subscriptions.controller.js";
import type { createSubscriptionsRepository } from "./subscriptions.repository.js";
import type { createSubscriptionsService } from "./subscriptions.service.js";

export type SubscriptionStateType = (typeof SUBSCRIPTION_STATES)[number];

export type SubscriptionRowType = typeof subscriptions.$inferSelect;
export type NewSubscriptionType = typeof subscriptions.$inferInsert;
export type SubscriptionChangesType = Omit<NewSubscriptionType, "tenantId" | "updatedAt">;

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

/** What every tenant user sees about the subscription in `/auth/me`, so the client can explain disabled actions. */
export interface SubscriptionStatusType {
  state: SubscriptionStateType;
  endDate: string;
  graceEndsOn: string;
}

/** Attached to the request by `subscriptionGuard`; read it through `subscriptionOf(req)`. */
export interface SubscriptionContextType {
  tenantId: string;
  subscription: SubscriptionViewType;
}

export interface GetSubscriptionResponseType {
  subscription: SubscriptionViewType;
  usage: UsageType;
}

export interface SubscriptionsRouterDepsType {
  db: Db;
  config: Config;
}

export type SubscriptionsRepositoryType = ReturnType<typeof createSubscriptionsRepository>;
export type SubscriptionsServiceType = ReturnType<typeof createSubscriptionsService>;
export type SubscriptionsControllerType = ReturnType<typeof createSubscriptionsController>;

export interface UsageType {
  activeUsers: number;
  userLimit: number;
  overLimit: boolean;
}
