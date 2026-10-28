import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { serviceResponseSchema } from './services.responses.js';
import { createServiceRequestSchema, listServicesQuerySchema, updateServiceFormRequestSchema, updateServiceRequestSchema } from './services.schemas.js';

const serviceParams = z.strictObject({ serviceId: idSchema });

export const servicesApi = defineApi({
  tag: 'services',
  prefix: '/services',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'List legal services with their form and allowed workflows',
      permission: { tenant: 'service.view' },
      query: listServicesQuerySchema,
      response: { kind: 'page', schema: serviceResponseSchema },
    }),
    get: defineEndpoint({
      method: 'get',
      path: '/:serviceId',
      summary: 'One legal service',
      permission: { tenant: 'service.view' },
      params: serviceParams,
      response: { kind: 'data', status: 200, schema: serviceResponseSchema },
    }),
    create: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Create a legal service with its allowed workflows',
      permission: { tenant: 'service.manage' },
      body: createServiceRequestSchema,
      response: { kind: 'data', status: 201, schema: serviceResponseSchema },
      errors: ['TAKEN'],
    }),
    update: defineEndpoint({
      method: 'patch',
      path: '/:serviceId',
      summary: "Edit a service's name, description, or allowed workflows",
      permission: { tenant: 'service.manage' },
      params: serviceParams,
      body: updateServiceRequestSchema,
      response: { kind: 'data', status: 200, schema: serviceResponseSchema },
      errors: ['TAKEN', 'RESOURCE_RETIRED'],
    }),
    updateForm: defineEndpoint({
      method: 'put',
      path: '/:serviceId/form',
      summary: "Replace a service's request form, checked against its revision",
      permission: { tenant: 'service.manage' },
      params: serviceParams,
      body: updateServiceFormRequestSchema,
      response: { kind: 'data', status: 200, schema: serviceResponseSchema },
      errors: ['RESOURCE_RETIRED', 'VERSION_CHANGED'],
    }),
    retire: defineEndpoint({
      method: 'post',
      path: '/:serviceId/retire',
      summary: 'Retire a service',
      permission: { tenant: 'service.manage' },
      params: serviceParams,
      response: { kind: 'data', status: 200, schema: serviceResponseSchema },
    }),
    restore: defineEndpoint({
      method: 'post',
      path: '/:serviceId/restore',
      summary: 'Restore a retired service',
      permission: { tenant: 'service.manage' },
      params: serviceParams,
      response: { kind: 'data', status: 200, schema: serviceResponseSchema },
      errors: ['TAKEN', 'SERVICE_WORKFLOW_RETIRED'],
    }),
  },
});
