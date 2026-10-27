import type { Db, Executor, Tx } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import type { Logger } from "@/logging/logger.js";
// Not the module index: that mounts routes through auth, which imports this module.
import { notify } from "@/modules/notifications/shared/notify.js";
import { holdersOf } from "@/modules/tenant-access/index.js";
import type { JobType } from "@/scheduler/index.js";
import {
  ENDING_SOON_DAYS,
  NOTICE_NOTIFICATION_KINDS,
  NOTICES_INTERVAL_MS,
} from "../subscriptions.constants.js";
import { createSubscriptionsRepository } from "../subscriptions.repository.js";
import type { NoticeKindType } from "../subscriptions.types.js";
import { addDays, subscriptionState } from "./subscription-state.js";

const repo = createSubscriptionsRepository();

/**
 * Remembers that a warning was sent: true when this call is the one that recorded it, false when it was already
 * recorded. The primary key decides, so several instances send it once (D9 applied to warnings, Phase 7 spec, 4.1).
 */
export async function recordNotice(
  tx: Tx,
  tenantId: string,
  kind: NoticeKindType,
  key: string,
): Promise<boolean> {
  return (await repo.insertNotice(tx, tenantId, kind, key)).length > 0;
}

/** Forgets a warning so the next crossing sends it again. */
export async function clearNotice(
  executor: Executor,
  tenantId: string,
  kind: NoticeKindType,
  key: string,
): Promise<void> {
  await repo.deleteNotice(executor, tenantId, kind, key);
}

export interface CheckSubscriptionNoticesOptionsType {
  logger: Logger;
  signal?: AbortSignal;
  /** The Riyadh date to check against; the database's when omitted. */
  today?: string;
}

export type SubscriptionNoticeCountsType = {
  endingSoon: number;
  graceStarted: number;
  readOnlyStarted: number;
  failed: number;
};

/** The one current notice for a subscription (Phase 7 spec, 4.3), or null. */
function currentNotice(
  subscription: { endDate: string; graceDays: number },
  today: string,
): NoticeKindType | null {
  switch (subscriptionState(subscription, today)) {
    case "read_only":
      return "subscription_read_only_started";
    case "grace":
      return "subscription_grace_started";
    case "active":
      return today >= addDays(subscription.endDate, -ENDING_SOON_DAYS)
        ? "subscription_ending_soon"
        : null;
  }
}

/** One tenant, in one transaction: read the subscription now, pick the notice, and tell the holders if it is new. */
async function noticeFor(
  tx: Tx,
  tenantId: string,
  todayOverride: string | undefined,
): Promise<NoticeKindType | null> {
  const [subscription] = await repo.findByTenantId(tx, tenantId);
  if (!subscription) {
    return null;
  }
  const today = todayOverride ?? (await repo.today(tx)).rows[0]?.today ?? "";
  const kind = currentNotice(subscription, today);
  if (!kind || !(await recordNotice(tx, tenantId, kind, subscription.endDate))) {
    return null;
  }
  const readOnlyFrom = addDays(subscription.endDate, subscription.graceDays + 1);
  await notify(tx, {
    tenantId,
    recipients: await holdersOf(tx, tenantId, "subscription.view"),
    kind: NOTICE_NOTIFICATION_KINDS[kind],
    data:
      kind === "subscription_grace_started"
        ? { endDate: subscription.endDate, readOnlyFrom }
        : { endDate: subscription.endDate },
  });
  return kind;
}

/**
 * One run of the hourly check (Phase 7 spec, 4.3 "Subscription warnings"): each tenant gets at most the one current
 * warning, once per end date, so a tenant first seen already in Read-only gets that notice and not the earlier ones.
 */
export async function checkSubscriptionNotices(
  db: Db,
  { logger, signal, today }: CheckSubscriptionNoticesOptionsType,
): Promise<SubscriptionNoticeCountsType> {
  const counts: SubscriptionNoticeCountsType = {
    endingSoon: 0,
    graceStarted: 0,
    readOnlyStarted: 0,
    failed: 0,
  };
  for (const { tenantId } of await repo.listTenantIds(db)) {
    if (signal?.aborted) {
      break;
    }
    try {
      const sent = await withTx(db, (tx) => noticeFor(tx, tenantId, today));
      if (sent === "subscription_ending_soon") {
        counts.endingSoon += 1;
      } else if (sent === "subscription_grace_started") {
        counts.graceStarted += 1;
      } else if (sent === "subscription_read_only_started") {
        counts.readOnlyStarted += 1;
      }
    } catch (err) {
      counts.failed += 1;
      logger.error({ err, tenantId }, "subscription notice check failed for the tenant");
    }
  }
  return counts;
}

export function createSubscriptionNoticesJob(): JobType {
  return {
    name: "subscriptions.notices",
    intervalMs: NOTICES_INTERVAL_MS,
    run: ({ db, logger, signal }) => checkSubscriptionNotices(db, { logger, signal }),
  };
}
