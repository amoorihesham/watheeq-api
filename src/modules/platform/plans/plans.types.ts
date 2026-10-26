import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { PAYMENT_PERIODS } from "./plans.config.js";
import type { createPlansController } from "./plans.controller.js";
import type { createPlansRepository } from "./plans.repository.js";
import type { planResponseSchema } from "./plans.responses.js";
import type {
  createPlanRequestSchema,
  listPlansQuerySchema,
  updatePlanRequestSchema,
} from "./plans.schemas.js";
import type { createPlansService } from "./plans.service.js";

export type PaymentPeriodType = (typeof PAYMENT_PERIODS)[number];

/** A plan as the repository reads it and the API returns it. */
export type PlanType = z.output<typeof planResponseSchema>;

export type CreatePlanRequestType = z.input<typeof createPlanRequestSchema>;
export type UpdatePlanRequestType = z.input<typeof updatePlanRequestSchema>;
export type NewPlanType = z.output<typeof createPlanRequestSchema>;
export type PlanChangesType = z.output<typeof updatePlanRequestSchema>;

export type ListPlansQueryType = z.output<typeof listPlansQuerySchema>;

export interface PlansRouterDepsType {
  db: Db;
  config: Config;
}

export type PlansRepositoryType = ReturnType<typeof createPlansRepository>;
export type PlansServiceType = ReturnType<typeof createPlansService>;
export type PlansControllerType = ReturnType<typeof createPlansController>;
