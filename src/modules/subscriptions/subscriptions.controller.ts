import type { HandlerOf } from '@/http/endpoint.js';
import { subscriptionOf } from './shared/middlewares.js';
import type { subscriptionsApi } from './subscriptions.endpoints.js';
import type { SubscriptionsServiceType } from './subscriptions.types.js';

export function createSubscriptionsController({ service }: { service: SubscriptionsServiceType }) {
  return {
    get: (async (_input, req) => service.get(subscriptionOf(req).tenantId)) satisfies HandlerOf<typeof subscriptionsApi.endpoints.get>,
  };
}
