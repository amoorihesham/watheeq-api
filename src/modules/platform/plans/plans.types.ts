import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { plans } from '@/db/schema/index.js';
import type { PlatformPermissionsOfType } from '@/modules/platform-access/index.js';
import type { PAYMENT_PERIODS } from './plans.constants.js';
import type { createPlansController } from './plans.controller.js';
import type { createPlansRepository } from './plans.repository.js';
import type { planResponseSchema } from './plans.responses.js';
import type { createPlanRequestSchema, listPlansQuerySchema, updatePlanRequestSchema } from './plans.schemas.js';
import type { createPlansService } from './plans.service.js';

export type PaymentPeriodType = (typeof PAYMENT_PERIODS)[number];

/** A plan as the repository reads it and audit entries record it. */
export type PlanType = typeof plans.$inferSelect;

/** A plan as the API returns it: the row plus its discounted price (R11.8). */
export type PlanResponseType = z.output<typeof planResponseSchema>;

export type CreatePlanRequestType = z.output<typeof createPlanRequestSchema>;
export type UpdatePlanRequestType = z.output<typeof updatePlanRequestSchema>;
export type NewPlanType = z.output<typeof createPlanRequestSchema>;
export type PlanChangesType = z.output<typeof updatePlanRequestSchema>;

export type ListPlansQueryType = z.output<typeof listPlansQuerySchema>;

export interface PlansRouterDepsType {
  db: Db;
  auth: AuthConfigType;
  platformPermissionsOf: PlatformPermissionsOfType;
}

export type PlansRepositoryType = ReturnType<typeof createPlansRepository>;
export type PlansServiceType = ReturnType<typeof createPlansService>;
export type PlansControllerType = ReturnType<typeof createPlansController>;
