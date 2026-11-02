import { type SQL, sql } from 'drizzle-orm';
import { subscriptions } from '@/db/schema/index.js';
import { riyadhToday } from '../subscriptions.repository.js';
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

/**
 * `subscriptionState` as an SQL condition on `subscriptions`, for list filters (P11.5). Tested against the
 * TypeScript rule over the boundary dates; change both together. `today` is a date expression, Riyadh's by default.
 */
export function subscriptionStateIs(state: SubscriptionStateType, today: SQL = sql`(${riyadhToday})::date`): SQL {
  const graceEnd = sql`${subscriptions.endDate} + ${subscriptions.graceDays}`;
  return {
    active: sql`${today} <= ${subscriptions.endDate}`,
    grace: sql`(${today} > ${subscriptions.endDate} and ${today} <= ${graceEnd})`,
    read_only: sql`${today} > ${graceEnd}`,
  }[state];
}
