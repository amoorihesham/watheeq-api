import { z } from 'zod';
import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { idSchema } from '@/http/validate.js';
import { userResponseSchema } from './users.responses.js';
import { assignRoleRequestSchema, inviteUserRequestSchema, listUsersQuerySchema, updateUserRequestSchema } from './users.schemas.js';

const userParams = z.strictObject({ userId: idSchema });

export const usersApi = defineApi({
  tag: 'users',
  prefix: '/users',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: "List the users the caller's directory scope reaches",
      permission: { tenant: 'user.view' },
      query: listUsersQuerySchema,
      response: { kind: 'page', schema: userResponseSchema },
    }),
    invite: defineEndpoint({
      method: 'post',
      path: '/',
      summary: 'Invite a user by email; they set their own password',
      permission: { tenant: 'user.create' },
      body: inviteUserRequestSchema,
      response: { kind: 'data', status: 201, schema: userResponseSchema },
      errors: ['TAKEN', 'USER_LIMIT_REACHED', 'PERMISSION_NOT_HELD'],
    }),
    get: defineEndpoint({
      method: 'get',
      path: '/:userId',
      summary: 'One user',
      permission: { tenant: 'user.view' },
      params: userParams,
      response: { kind: 'data', status: 200, schema: userResponseSchema },
    }),
    update: defineEndpoint({
      method: 'patch',
      path: '/:userId',
      summary: "Edit a user's name, unit, or manager flag",
      permission: { tenant: 'user.update' },
      params: userParams,
      body: updateUserRequestSchema,
      response: { kind: 'data', status: 200, schema: userResponseSchema },
    }),
    assignRole: defineEndpoint({
      method: 'put',
      path: '/:userId/role',
      summary: 'Assign a role to a user under the subset rule',
      permission: { tenant: 'role.assign' },
      params: userParams,
      body: assignRoleRequestSchema,
      response: { kind: 'data', status: 200, schema: userResponseSchema },
      errors: ['SELF_CHANGE_FORBIDDEN', 'PERMISSION_NOT_HELD', 'OWNER_PROTECTED'],
    }),
    deactivate: defineEndpoint({
      method: 'post',
      path: '/:userId/deactivate',
      summary: 'Deactivate a user and end their sessions',
      permission: { tenant: 'user.deactivate' },
      params: userParams,
      response: { kind: 'data', status: 200, schema: userResponseSchema },
      errors: ['SELF_CHANGE_FORBIDDEN', 'PERMISSION_NOT_HELD', 'OWNER_PROTECTED'],
    }),
    reactivate: defineEndpoint({
      method: 'post',
      path: '/:userId/reactivate',
      summary: 'Reactivate a deactivated user',
      permission: { tenant: 'user.deactivate' },
      params: userParams,
      response: { kind: 'data', status: 200, schema: userResponseSchema },
      errors: ['PERMISSION_NOT_HELD', 'USER_LIMIT_REACHED'],
    }),
    resendInvitation: defineEndpoint({
      method: 'post',
      path: '/:userId/resend-invitation',
      summary: 'Send a user who has not set a password a fresh invitation',
      permission: { tenant: 'user.create' },
      params: userParams,
      response: { kind: 'noContent' },
      errors: ['ALREADY_VERIFIED', 'USER_INACTIVE'],
    }),
  },
});
