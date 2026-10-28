import type { z } from 'zod';
import type { AuthConfigType, FrontendConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { EmailSenderType } from '@/email/index.js';
import type { createTenantsController } from './tenants.controller.js';
import type { createTenantsRepository } from './tenants.repository.js';
import type { tenantDetailResponseSchema, tenantResponseSchema } from './tenants.responses.js';
import type { changeSubscriptionRequestSchema, createTenantRequestSchema, listTenantsQuerySchema } from './tenants.schemas.js';
import type { createTenantsService } from './tenants.service.js';

export type TenantType = z.output<typeof tenantResponseSchema>;

export interface NewTenantType {
  name: string;
  slug: string;
  ownerId: string;
}

export interface TenantOwnerType {
  id: string;
  email: string;
  userName: string;
  emailVerifiedAt: Date | null;
}

export type CreateTenantRequestType = z.output<typeof createTenantRequestSchema>;
export type ChangeSubscriptionRequestType = z.output<typeof changeSubscriptionRequestSchema>;

export type TenantDetailType = z.output<typeof tenantDetailResponseSchema>;
export type ListTenantsQueryType = z.output<typeof listTenantsQuerySchema>;

export interface TenantsSettingsType {
  appBaseUrl: string;
  verificationTokenTtlSeconds: number;
}

export interface TenantsRouterDepsType {
  db: Db;
  auth: AuthConfigType;
  frontend: FrontendConfigType;
  emailSender: EmailSenderType;
}

export type TenantsRepositoryType = ReturnType<typeof createTenantsRepository>;
export type TenantsServiceType = ReturnType<typeof createTenantsService>;
export type TenantsControllerType = ReturnType<typeof createTenantsController>;
