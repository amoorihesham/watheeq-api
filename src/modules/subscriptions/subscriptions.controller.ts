import type { RequestHandler } from "express";
import { subscriptionOf } from "./shared/middlewares.js";
import type {
  GetSubscriptionResponseType,
  SubscriptionsServiceType,
} from "./subscriptions.types.js";

export function createSubscriptionsController({ service }: { service: SubscriptionsServiceType }) {
  return {
    get: (async (req, res) => {
      const result = await service.get(subscriptionOf(req).tenantId);
      res.status(200).json(result satisfies GetSubscriptionResponseType);
    }) satisfies RequestHandler,
  };
}
