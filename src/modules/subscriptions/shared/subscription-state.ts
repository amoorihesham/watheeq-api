import type { SubscriptionStateType } from '../subscriptions.types.js';

/** `YYYY-MM-DD` plus whole days, computed in UTC so no local time zone or DST shifts the date. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Active through the end date, Grace for `graceDays` after it, Read-only after that (R1.7).
 * Never stored, so renewal takes effect on the next request (P1.4). ISO dates compare correctly as strings.
 */
export function subscriptionState(subscription: { endDate: string; graceDays: number }, today: string): SubscriptionStateType {
  if (today <= subscription.endDate) {
    return 'active';
  }
  if (today <= addDays(subscription.endDate, subscription.graceDays)) {
    return 'grace';
  }
  return 'read_only';
}
