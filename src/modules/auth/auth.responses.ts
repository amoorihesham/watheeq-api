import { z } from 'zod';
import { subscriptionStatusResponseSchema } from '@/modules/subscriptions/subscriptions.responses.js';

export const authUserResponseSchema = z
  .strictObject({
    id: z.string(),
    email: z.string(),
    userName: z.string(),
    role: z.enum(['user', 'operator']),
    tenant: z
      .strictObject({
        id: z.string(),
        roleId: z.string(),
        roleName: z.string(),
        permissions: z.array(z.string()),
      })
      .nullable(),
  })
  .meta({ id: 'AuthUser' });

/** The session: what `GET /auth/me` answers, and what login and refresh answer too (Q17). */
export const sessionResponseSchema = z
  .strictObject({
    user: authUserResponseSchema,
    /** Null for an operator. Lets the client explain why actions are disabled in Grace or Read-only (R1.11). */
    subscription: subscriptionStatusResponseSchema.nullable(),
  })
  .meta({ id: 'Session' });
