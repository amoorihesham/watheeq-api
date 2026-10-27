import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { idSchema } from "@/http/validate.js";
import { planResponseSchema } from "./plans.responses.js";
import {
  createPlanRequestSchema,
  listPlansQuerySchema,
  updatePlanRequestSchema,
} from "./plans.schemas.js";

const planParams = z.strictObject({ planId: idSchema });

export const plansApi = defineApi({
  tag: "operator-plans",
  prefix: "/operator/plans",
  realm: "operator",
  endpoints: {
    create: defineEndpoint({
      method: "post",
      path: "/",
      summary: "Create a subscription plan",
      permission: { platform: "platform.plan.create" },
      body: createPlanRequestSchema,
      response: { kind: "data", status: 201, schema: planResponseSchema },
      errors: ["TAKEN"],
    }),
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "List subscription plans",
      permission: { platform: "platform.plan.view" },
      query: listPlansQuerySchema,
      response: { kind: "page", schema: planResponseSchema },
    }),
    get: defineEndpoint({
      method: "get",
      path: "/:planId",
      summary: "One subscription plan",
      permission: { platform: "platform.plan.view" },
      params: planParams,
      response: { kind: "data", status: 200, schema: planResponseSchema },
    }),
    update: defineEndpoint({
      method: "patch",
      path: "/:planId",
      summary: "Edit a plan; existing subscriptions keep the terms they copied",
      permission: { platform: "platform.plan.update" },
      params: planParams,
      body: updatePlanRequestSchema,
      response: { kind: "data", status: 200, schema: planResponseSchema },
      errors: ["TAKEN"],
    }),
  },
});
