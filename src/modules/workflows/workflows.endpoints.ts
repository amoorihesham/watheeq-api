import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { versionResponseSchema, workflowResponseSchema, workflowSummaryResponseSchema } from './workflows.responses.js';
import { createWorkflowRequestSchema, listWorkflowsQuerySchema, updateWorkflowRequestSchema, versionNumberSchema } from './workflows.schemas.js';

const workflowParams = z.strictObject({ workflowId: idSchema });

export const workflowsApi = defineApi({
  tag: 'workflows',
  prefix: '/workflows',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'List workflows with their current version header',
      permission: { tenant: 'workflow.view' },
      query: listWorkflowsQuerySchema,
      response: { kind: 'page', schema: workflowSummaryResponseSchema },
    }),
    get: defineEndpoint({
      method: 'get',
      path: '/:workflowId',
      summary: 'One workflow with its current version and stages',
      permission: { tenant: 'workflow.view' },
      params: workflowParams,
      response: { kind: 'data', status: 200, schema: workflowResponseSchema },
    }),
    getVersion: defineEndpoint({
      method: 'get',
      path: '/:workflowId/versions/:number',
      summary: 'Any version of a workflow, current or earlier',
      permission: { tenant: 'workflow.view' },
      params: workflowParams.extend({ number: versionNumberSchema }),
      response: { kind: 'data', status: 200, schema: versionResponseSchema },
    }),
    create: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Create a workflow with version 1',
      permission: { tenant: 'workflow.manage' },
      body: createWorkflowRequestSchema,
      response: { kind: 'data', status: 201, schema: workflowResponseSchema },
      errors: ['TAKEN'],
    }),
    update: defineEndpoint({
      method: 'put',
      path: '/:workflowId',
      summary: 'Save a new version of a workflow',
      permission: { tenant: 'workflow.manage' },
      params: workflowParams,
      body: updateWorkflowRequestSchema,
      response: { kind: 'data', status: 200, schema: workflowResponseSchema },
      errors: ['TAKEN', 'RESOURCE_RETIRED', 'VERSION_CHANGED'],
    }),
    retire: defineEndpoint({
      method: 'post',
      path: '/:workflowId/retire',
      summary: 'Retire a workflow no service still allows',
      permission: { tenant: 'workflow.manage' },
      params: workflowParams,
      response: { kind: 'data', status: 200, schema: workflowResponseSchema },
      errors: ['WORKFLOW_IN_USE'],
    }),
    restore: defineEndpoint({
      method: 'post',
      path: '/:workflowId/restore',
      summary: 'Restore a retired workflow',
      permission: { tenant: 'workflow.manage' },
      params: workflowParams,
      response: { kind: 'data', status: 200, schema: workflowResponseSchema },
      errors: ['TAKEN', 'WORKFLOW_POSITION_RETIRED'],
    }),
  },
});
