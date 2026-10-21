import type {
  SubscriptionRowType,
  SubscriptionViewType,
  UsageType,
} from "../subscriptions.types.js";
import { effectivePrice } from "./pricing.js";
import { addDays, subscriptionState } from "./subscription-state.js";

export function toSubscriptionView(row: SubscriptionRowType, today: string): SubscriptionViewType {
  return {
    planId: row.planId,
    planName: row.planName,
    userLimit: row.userLimit,
    graceDays: row.graceDays,
    startDate: row.startDate,
    endDate: row.endDate,
    graceEndsOn: addDays(row.endDate, row.graceDays),
    state: subscriptionState(row, today),
    pricing: {
      priceHalalas: row.priceHalalas,
      paymentPeriod: row.paymentPeriod,
      planDiscountPercent: row.planDiscountPercent,
      customerDiscountPercent: row.customerDiscountPercent,
      effectivePriceHalalas: effectivePrice(row),
    },
  };
}

export function toUsage(activeUsers: number, userLimit: number): UsageType {
  return { activeUsers, userLimit, overLimit: activeUsers > userLimit };
}
