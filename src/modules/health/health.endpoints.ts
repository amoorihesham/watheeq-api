import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { healthResponseSchema } from './health.responses.js';

export const healthApi = defineApi({
  tag: 'health',
  prefix: '/',
  realm: 'open',
  endpoints: {
    health: defineEndpoint({
      method: 'get',
      path: '/health',
      summary: 'Whether the server can reach its database',
      response: { kind: 'data', status: 200, schema: healthResponseSchema },
      errors: ['SERVICE_UNAVAILABLE'],
    }),
  },
});
