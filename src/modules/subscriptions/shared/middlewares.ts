import type { Request, RequestHandler } from "express";
import type { Db } from "@/db/pool.js";
import { AppError } from "@/http/errors.js";
import { createSubscriptionsRepository } from "../subscriptions.repository.js";
import type { SubscriptionContextType } from "../subscriptions.types.js";
import { toSubscriptionView } from "./view.js";

const repo = createSubscriptionsRepository();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Mount on every tenant router after `authenticate()` and `requireRole("user")`. Loads the caller's subscription
 * on each request, so a renewal takes effect immediately (R1.8). In Read-only every unsafe method is refused by
 * default (P1.6), so a future write route is protected without its author having to remember.
 * Reads `req.auth` directly rather than auth's `principalOf`, so this module never imports auth (no import cycle).
 */
export function subscriptionGuard(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const tenantId = req.auth?.tenant?.id;
    if (!tenantId) {
      throw new AppError("FORBIDDEN");
    }
    const [row] = await repo.findByTenantId(db, tenantId);
    if (!row) {
      throw new Error(`tenant ${tenantId} has no subscription`);
    }
    const today = (await repo.today(db)).rows[0]?.today ?? "";
    const subscription = toSubscriptionView(row, today);
    if (subscription.state === "read_only" && !SAFE_METHODS.has(req.method)) {
      throw new AppError("SUBSCRIPTION_READ_ONLY");
    }
    req.subscription = { tenantId, subscription };
    next();
  };
}

/** Mount after `subscriptionGuard` on routes that need Active, such as request submission (R1.10). */
export function requireActiveSubscription(): RequestHandler {
  return (req, _res, next) => {
    if (subscriptionOf(req).subscription.state !== "active") {
      throw new AppError("SUBSCRIPTION_NOT_ACTIVE");
    }
    next();
  };
}

/** The guarded request's subscription; reaching this without `subscriptionGuard` is a wiring bug. */
export function subscriptionOf(req: Request): SubscriptionContextType {
  if (!req.subscription) {
    throw new Error("subscriptionGuard is not mounted on this route");
  }
  return req.subscription;
}
