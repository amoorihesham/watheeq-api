import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { subscriptions, tenantNoticeKinds } from "@/db/schema/index.js";
import type { SUBSCRIPTION_STATES } from "./subscriptions.constants.js";
import type { createSubscriptionsController } from "./subscriptions.controller.js";
import type { createSubscriptionsRepository } from "./subscriptions.repository.js";
import type {
  getSubscriptionResponseSchema,
  subscriptionStatusResponseSchema,
  subscriptionViewResponseSchema,
  usageResponseSchema,
} from "./subscriptions.responses.js";
import type { createSubscriptionsService } from "./subscriptions.service.js";

export type SubscriptionStateType = (typeof SUBSCRIPTION_STATES)[number];

export type SubscriptionRowType = typeof subscriptions.$inferSelect;
export type NoticeKindType = (typeof tenantNoticeKinds.enumValues)[number];
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

export type SubscriptionViewType = z.output<typeof subscriptionViewResponseSchema>;
export type SubscriptionStatusType = z.output<typeof subscriptionStatusResponseSchema>;
export type UsageType = z.output<typeof usageResponseSchema>;
export type StorageUsageType = UsageType["storage"];
export type GetSubscriptionResponseType = z.output<typeof getSubscriptionResponseSchema>;

/** Attached to the request by `subscriptionGuard`; read it through `subscriptionOf(req)`. */
export interface SubscriptionContextType {
  tenantId: string;
  subscription: SubscriptionViewType;
}

export interface SubscriptionsRouterDepsType {
  db: Db;
  config: Config;
}

export type SubscriptionsRepositoryType = ReturnType<typeof createSubscriptionsRepository>;
export type SubscriptionsServiceType = ReturnType<typeof createSubscriptionsService>;
export type SubscriptionsControllerType = ReturnType<typeof createSubscriptionsController>;
