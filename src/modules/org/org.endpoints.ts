import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { orgTreeResponseSchema, orgUnitResponseSchema } from './org.responses.js';
import { createUnitRequestSchema, updateUnitRequestSchema } from './org.schemas.js';

const unitParams = z.strictObject({ unitId: idSchema });

export const orgApi = defineApi({
  tag: 'org',
  prefix: '/org-units',
  realm: 'tenant',
  endpoints: {
    tree: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'The organization tree with managers and member counts',
      permission: { tenant: 'org.view' },
      response: { kind: 'data', status: 200, schema: orgTreeResponseSchema },
    }),
    create: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Create a department, or a section under a department',
      permission: { tenant: 'org.manage' },
      body: createUnitRequestSchema,
      response: { kind: 'data', status: 201, schema: orgUnitResponseSchema },
      errors: ['TAKEN'],
    }),
    update: defineEndpoint({
      method: 'patch',
      path: '/:unitId',
      summary: 'Rename a unit or move a section to another department',
      permission: { tenant: 'org.manage' },
      params: unitParams,
      body: updateUnitRequestSchema,
      response: { kind: 'data', status: 200, schema: orgUnitResponseSchema },
      errors: ['TAKEN'],
    }),
    delete: defineEndpoint({
      method: 'delete',
      path: '/:unitId',
      summary: 'Delete an empty unit',
      permission: { tenant: 'org.manage' },
      params: unitParams,
      response: { kind: 'noContent' },
      errors: ['UNIT_NOT_EMPTY'],
    }),
  },
});
