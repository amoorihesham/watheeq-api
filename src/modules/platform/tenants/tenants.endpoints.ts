import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { idSchema } from "@/http/validate.js";
import { tenantDetailResponseSchema } from "./tenants.responses.js";
import {
  changeSubscriptionRequestSchema,
  createTenantRequestSchema,
  listTenantsQuerySchema,
} from "./tenants.schemas.js";

const tenantParams = z.strictObject({ tenantId: idSchema });

export const tenantsApi = defineApi({
  tag: "operator-tenants",
  prefix: "/operator/tenants",
  realm: "operator",
  endpoints: {
    create: defineEndpoint({
      method: "post",
      path: "/",
      summary: "Create a tenant with its first Tenant Admin and subscription",
      permission: { platform: "platform.tenant.create" },
      body: createTenantRequestSchema,
      response: { kind: "data", status: 201, schema: tenantDetailResponseSchema },
      errors: ["TAKEN"],
    }),
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "List tenants with their subscription and usage",
      permission: { platform: "platform.tenant.view" },
      query: listTenantsQuerySchema,
      response: { kind: "page", schema: tenantDetailResponseSchema },
    }),
    get: defineEndpoint({
      method: "get",
      path: "/:tenantId",
      summary: "One tenant with its subscription and usage",
      permission: { platform: "platform.tenant.view" },
      params: tenantParams,
      response: { kind: "data", status: 200, schema: tenantDetailResponseSchema },
    }),
    changeSubscription: defineEndpoint({
      method: "put",
      path: "/:tenantId/subscription",
      summary: "Renew, extend, change plan, or end a subscription early",
      permission: { platform: "platform.subscription.update" },
      params: tenantParams,
      body: changeSubscriptionRequestSchema,
      response: { kind: "data", status: 200, schema: tenantDetailResponseSchema },
    }),
    resendVerification: defineEndpoint({
      method: "post",
      path: "/:tenantId/admin/resend-verification",
      summary: "Send the Tenant Admin a fresh verification link",
      permission: { platform: "platform.tenant.create" },
      params: tenantParams,
      response: { kind: "noContent" },
      errors: ["ALREADY_VERIFIED"],
    }),
  },
});
