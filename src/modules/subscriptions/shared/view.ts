import { BYTES_PER_GB } from '../subscriptions.constants.js';
import type { SubscriptionRowType, SubscriptionStatusType, SubscriptionViewType, UsageType } from '../subscriptions.types.js';
import { effectivePrice } from './pricing.js';
import { addDays, subscriptionState } from './subscription-state.js';

export function toSubscriptionView(row: SubscriptionRowType, today: string): SubscriptionViewType {
  return {
    planId: row.planId,
    planName: row.planName,
    userLimit: row.userLimit,
    storageLimitGb: row.storageLimitGb,
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

export function toSubscriptionStatus(row: { endDate: string; graceDays: number }, today: string): SubscriptionStatusType {
  return {
    state: subscriptionState(row, today),
    endDate: row.endDate,
    graceEndsOn: addDays(row.endDate, row.graceDays),
  };
}

/** What the subscription's limits are measured against: active members, and every stored byte (R5.5.18). */
export function toUsage(activeUsers: number, storedBytes: number, limits: { userLimit: number; storageLimitGb: number }): UsageType {
  const limitBytes = limits.storageLimitGb * BYTES_PER_GB;
  return {
    activeUsers,
    userLimit: limits.userLimit,
    overLimit: activeUsers > limits.userLimit,
    storage: { usedBytes: storedBytes, limitBytes, overLimit: storedBytes > limitBytes },
  };
}
