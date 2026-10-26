import type { RequestHandler } from "express";
import { sendData } from "@/http/respond.js";
import { subscriptionOf } from "./shared/middlewares.js";
import { getSubscriptionResponseSchema } from "./subscriptions.responses.js";
import type { SubscriptionsServiceType } from "./subscriptions.types.js";

export function createSubscriptionsController({ service }: { service: SubscriptionsServiceType }) {
  return {
    get: (async (req, res) => {
      const result = await service.get(subscriptionOf(req).tenantId);
      sendData(res, 200, getSubscriptionResponseSchema, result);
    }) satisfies RequestHandler,
  };
}
