import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { escalationResponseSchema } from "./escalation.responses.js";
import { putEscalationRequestSchema } from "./escalation.schemas.js";

export const escalationApi = defineApi({
  tag: "escalation",
  prefix: "/escalation",
  realm: "tenant",
  endpoints: {
    get: defineEndpoint({
      method: "get",
      path: "/",
      summary: "The tenant's escalation settings, or none until saved",
      permission: { tenant: "escalation.view" },
      response: { kind: "data", status: 200, schema: escalationResponseSchema },
    }),
    put: defineEndpoint({
      method: "put",
      path: "/",
      summary: "Save the escalation settings of rules R0, R1, and R2",
      permission: { tenant: "escalation.manage" },
      body: putEscalationRequestSchema,
      response: { kind: "data", status: 200, schema: escalationResponseSchema },
    }),
  },
});
