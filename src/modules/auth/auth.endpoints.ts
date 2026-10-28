import { defineApi, defineEndpoint } from '@/http/endpoint.js';
import { sessionResponseSchema } from './auth.responses.js';
import { changePasswordRequestSchema, loginRequestSchema, passwordResetRequestSchema, resetPasswordRequestSchema, verifyEmailRequestSchema } from './auth.schemas.js';

export const authApi = defineApi({
  tag: 'auth',
  prefix: '/auth',
  realm: 'public',
  endpoints: {
    login: defineEndpoint({
      method: 'post',
      path: '/login',
      summary: 'Sign in; sets the access and refresh cookies',
      body: loginRequestSchema,
      response: { kind: 'data', status: 200, schema: sessionResponseSchema },
      errors: ['INVALID_CREDENTIALS'],
    }),
    refresh: defineEndpoint({
      method: 'post',
      path: '/refresh',
      summary: 'Rotate the refresh cookie and issue a new session',
      response: { kind: 'data', status: 200, schema: sessionResponseSchema },
      errors: ['UNAUTHENTICATED'],
    }),
    logout: defineEndpoint({
      method: 'post',
      path: '/logout',
      summary: 'Revoke the refresh token and clear both cookies',
      response: { kind: 'noContent' },
    }),
    verifyEmail: defineEndpoint({
      method: 'post',
      path: '/verify',
      summary: 'Use an invitation or verification link to set a password',
      body: verifyEmailRequestSchema,
      response: { kind: 'noContent' },
      errors: ['VERIFICATION_INVALID'],
    }),
    me: defineEndpoint({
      method: 'get',
      path: '/me',
      realm: 'session',
      summary: 'The signed-in user and their subscription status',
      response: { kind: 'data', status: 200, schema: sessionResponseSchema },
    }),
    changePassword: defineEndpoint({
      method: 'post',
      path: '/password',
      realm: 'session',
      summary: 'Change the password and sign out the other sessions',
      body: changePasswordRequestSchema,
      response: { kind: 'noContent' },
      errors: ['INVALID_CREDENTIALS'],
    }),
    requestPasswordReset: defineEndpoint({
      method: 'post',
      path: '/password-reset/request',
      summary: 'Email a password reset link; always 204',
      body: passwordResetRequestSchema,
      response: { kind: 'noContent' },
    }),
    resetPassword: defineEndpoint({
      method: 'post',
      path: '/password-reset',
      summary: 'Use a reset link to set a new password',
      body: resetPasswordRequestSchema,
      response: { kind: 'noContent' },
      errors: ['VERIFICATION_INVALID'],
    }),
  },
});
