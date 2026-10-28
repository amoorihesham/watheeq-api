import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { positionResponseSchema } from './positions.responses.js';
import { createPositionRequestSchema, listPositionsQuerySchema, renamePositionRequestSchema, setHoldersRequestSchema } from './positions.schemas.js';

const positionParams = z.strictObject({ positionId: idSchema });

export const positionsApi = defineApi({
  tag: 'positions',
  prefix: '/positions',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'List positions, optionally of one unit',
      permission: { tenant: 'position.view' },
      query: listPositionsQuerySchema,
      response: { kind: 'page', schema: positionResponseSchema },
    }),
    get: defineEndpoint({
      method: 'get',
      path: '/:positionId',
      summary: 'One position with its holders',
      permission: { tenant: 'position.view' },
      params: positionParams,
      response: { kind: 'data', status: 200, schema: positionResponseSchema },
    }),
    create: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Create a position in an org unit',
      permission: { tenant: 'position.manage' },
      body: createPositionRequestSchema,
      response: { kind: 'data', status: 201, schema: positionResponseSchema },
      errors: ['TAKEN'],
    }),
    rename: defineEndpoint({
      method: 'patch',
      path: '/:positionId',
      summary: 'Rename a position',
      permission: { tenant: 'position.manage' },
      params: positionParams,
      body: renamePositionRequestSchema,
      response: { kind: 'data', status: 200, schema: positionResponseSchema },
      errors: ['TAKEN', 'RESOURCE_RETIRED'],
    }),
    setHolders: defineEndpoint({
      method: 'put',
      path: '/:positionId/holders',
      summary: 'Replace the holders of a position',
      permission: { tenant: 'position.manage' },
      params: positionParams,
      body: setHoldersRequestSchema,
      response: { kind: 'data', status: 200, schema: positionResponseSchema },
      errors: ['RESOURCE_RETIRED'],
    }),
    retire: defineEndpoint({
      method: 'post',
      path: '/:positionId/retire',
      summary: 'Retire a position no workflow or escalation setting uses',
      permission: { tenant: 'position.manage' },
      params: positionParams,
      response: { kind: 'data', status: 200, schema: positionResponseSchema },
      errors: ['POSITION_IN_USE'],
    }),
    restore: defineEndpoint({
      method: 'post',
      path: '/:positionId/restore',
      summary: 'Restore a retired position',
      permission: { tenant: 'position.manage' },
      params: positionParams,
      response: { kind: 'data', status: 200, schema: positionResponseSchema },
      errors: ['TAKEN', 'POSITION_UNIT_GONE'],
    }),
  },
});
