import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { PAYMENT_PERIODS } from "./plans.config.js";
import type { createPlansController } from "./plans.controller.js";
import type { createPlansRepository } from "./plans.repository.js";
import type { createPlanRequestSchema, updatePlanRequestSchema } from "./plans.schemas.js";
import type { createPlansService } from "./plans.service.js";

export type PaymentPeriodType = (typeof PAYMENT_PERIODS)[number];

/** A plan as the repository reads it and the API returns it. */
export interface PlanType {
  id: string;
  name: string;
  userLimit: number;
  graceDays: number;
  priceHalalas: number;
  paymentPeriod: PaymentPeriodType;
  discountPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePlanRequestType = z.input<typeof createPlanRequestSchema>;
export type UpdatePlanRequestType = z.input<typeof updatePlanRequestSchema>;
export type NewPlanType = z.output<typeof createPlanRequestSchema>;
export type PlanChangesType = z.output<typeof updatePlanRequestSchema>;

export interface CreatePlanResponseType {
  plan: PlanType;
}
export type GetPlanResponseType = CreatePlanResponseType;
export type UpdatePlanResponseType = CreatePlanResponseType;
export interface ListPlansResponseType {
  plans: PlanType[];
}

export interface PlansRouterDepsType {
  db: Db;
  config: Config;
}

export type PlansRepositoryType = ReturnType<typeof createPlansRepository>;
export type PlansServiceType = ReturnType<typeof createPlansService>;
export type PlansControllerType = ReturnType<typeof createPlansController>;
