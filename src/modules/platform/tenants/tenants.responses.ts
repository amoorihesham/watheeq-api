import { z } from 'zod';
import { emailSendOutcomes } from '@/db/schema/index.js';
import { subscriptionViewResponseSchema, usageResponseSchema } from '@/modules/subscriptions/index.js';

/** The first Tenant Admin. `verificationEmail` is the outcome of their newest link's email, null once verified or when unknown (P11.2). */
export const tenantOwnerResponseSchema = z
  .strictObject({
    id: z.string(),
    email: z.string(),
    userName: z.string(),
    verifiedAt: z.date().nullable(),
    verificationEmail: z.enum(emailSendOutcomes.enumValues).nullable(),
  })
  .meta({ id: 'TenantOwner' });

export const tenantResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    owner: tenantOwnerResponseSchema,
    createdAt: z.date(),
  })
  .meta({ id: 'Tenant' });

/** The one tenant shape: create, get, each list item, and a subscription change all answer it (Q18). */
export const tenantDetailResponseSchema = z
  .strictObject({
    tenant: tenantResponseSchema,
    subscription: subscriptionViewResponseSchema,
    usage: usageResponseSchema,
  })
  .meta({ id: 'TenantDetail' });
