import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { getSubscriptionResponseSchema } from './subscriptions.responses.js';

export const subscriptionsApi = defineApi({
  tag: 'subscriptions',
  prefix: '/subscription',
  realm: 'tenant',
  endpoints: {
    get: defineEndpoint({
      method: 'get',
      path: '/',
      summary: "The tenant's subscription, pricing, and usage",
      permission: { tenant: 'subscription.view' },
      response: { kind: 'data', status: 200, schema: getSubscriptionResponseSchema },
    }),
  },
});
