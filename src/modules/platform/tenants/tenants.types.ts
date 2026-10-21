import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { tenants } from "@/db/schema/index.js";
import type { EmailSenderType } from "@/email/index.js";
import type { SubscriptionViewType, UsageType } from "@/modules/subscriptions/index.js";
import type { createTenantsController } from "./tenants.controller.js";
import type { createTenantsRepository } from "./tenants.repository.js";
import type { createTenantRequestSchema } from "./tenants.schemas.js";
import type { createTenantsService } from "./tenants.service.js";

export type TenantType = typeof tenants.$inferSelect;

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

export type CreateTenantRequestType = z.input<typeof createTenantRequestSchema>;

export interface CreateTenantResponseType {
  tenant: TenantType;
  subscription: SubscriptionViewType;
  admin: { id: string; email: string };
}

export interface TenantDetailType {
  tenant: TenantType;
  subscription: SubscriptionViewType;
  usage: UsageType;
}
export type GetTenantResponseType = TenantDetailType;
export interface ListTenantsResponseType {
  tenants: TenantDetailType[];
}

export interface TenantsSettingsType {
  appBaseUrl: string;
  verificationTokenTtlSeconds: number;
}

export interface TenantsRouterDepsType {
  db: Db;
  config: Config;
  emailSender: EmailSenderType;
}

export type TenantsRepositoryType = ReturnType<typeof createTenantsRepository>;
export type TenantsServiceType = ReturnType<typeof createTenantsService>;
export type TenantsControllerType = ReturnType<typeof createTenantsController>;
