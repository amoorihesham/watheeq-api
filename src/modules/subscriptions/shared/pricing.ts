import type { PricingInputType } from "../subscriptions.types.js";

const HUNDREDTHS_OF_PERCENT = 10_000n;

/**
 * The price per payment period after the plan discount, then the customer discount (P1.20).
 * Integer arithmetic in hundredths of a percent, rounded half up to the halala: 999 with 12.5% off is 874.
 */
export function effectivePrice({
  priceHalalas,
  planDiscountPercent,
  customerDiscountPercent,
}: PricingInputType): number {
  const keepPlan = HUNDREDTHS_OF_PERCENT - BigInt(Math.round(planDiscountPercent * 100));
  const keepCustomer = HUNDREDTHS_OF_PERCENT - BigInt(Math.round(customerDiscountPercent * 100));
  const numerator = BigInt(priceHalalas) * keepPlan * keepCustomer;
  const denominator = HUNDREDTHS_OF_PERCENT * HUNDREDTHS_OF_PERCENT;
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}
