import { z } from 'zod';
import { ORG_UNIT_KINDS } from '@/modules/org/index.js';
import { USER_STATUSES } from './users.constants.js';

export const userResponseSchema = z
  .strictObject({
    id: z.string(),
    email: z.string(),
    userName: z.string(),
    unit: z.strictObject({ id: z.string(), name: z.string(), kind: z.enum(ORG_UNIT_KINDS) }).nullable(),
    isManager: z.boolean(),
    role: z.strictObject({ id: z.string(), name: z.string(), isSystem: z.boolean() }),
    isOwner: z.boolean(),
    /** `invited`: has not set a password yet; `inactive`: deactivated. */
    status: z.enum(USER_STATUSES),
    createdAt: z.date(),
  })
  .meta({ id: 'User' });
