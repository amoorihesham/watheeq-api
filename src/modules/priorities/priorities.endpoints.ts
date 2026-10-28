import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { priorityResponseSchema } from './priorities.responses.js';
import { createPriorityRequestSchema, listPrioritiesQuerySchema, reorderPrioritiesRequestSchema, updatePriorityRequestSchema } from './priorities.schemas.js';

const priorityParams = z.strictObject({ priorityId: idSchema });

export const prioritiesApi = defineApi({
  tag: 'priorities',
  prefix: '/priorities',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'List priorities in display order',
      permission: { tenant: 'priority.view' },
      query: listPrioritiesQuerySchema,
      response: { kind: 'page', schema: priorityResponseSchema },
    }),
    create: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Create a priority at the end of the order',
      permission: { tenant: 'priority.manage' },
      body: createPriorityRequestSchema,
      response: { kind: 'data', status: 201, schema: priorityResponseSchema },
      errors: ['TAKEN'],
    }),
    reorder: defineEndpoint({
      method: 'put',
      path: '/order',
      summary: 'Set the display order of the active priorities',
      permission: { tenant: 'priority.manage' },
      body: reorderPrioritiesRequestSchema,
      response: { kind: 'noContent' },
    }),
    update: defineEndpoint({
      method: 'patch',
      path: '/:priorityId',
      summary: 'Rename a priority or change its days',
      permission: { tenant: 'priority.manage' },
      params: priorityParams,
      body: updatePriorityRequestSchema,
      response: { kind: 'data', status: 200, schema: priorityResponseSchema },
      errors: ['TAKEN', 'RESOURCE_RETIRED'],
    }),
    retire: defineEndpoint({
      method: 'post',
      path: '/:priorityId/retire',
      summary: 'Retire a priority',
      permission: { tenant: 'priority.manage' },
      params: priorityParams,
      response: { kind: 'data', status: 200, schema: priorityResponseSchema },
    }),
    restore: defineEndpoint({
      method: 'post',
      path: '/:priorityId/restore',
      summary: 'Restore a retired priority at the end of the order',
      permission: { tenant: 'priority.manage' },
      params: priorityParams,
      response: { kind: 'data', status: 200, schema: priorityResponseSchema },
      errors: ['TAKEN'],
    }),
  },
});
