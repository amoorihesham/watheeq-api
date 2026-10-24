import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import { MAX_SERVICE_DESCRIPTION_LENGTH, MAX_SERVICE_NAME_LENGTH } from "./services.config.js";

const serviceName = z.string().trim().min(1).max(MAX_SERVICE_NAME_LENGTH);

// A blank description is no description.
const description = z
  .string()
  .trim()
  .max(MAX_SERVICE_DESCRIPTION_LENGTH)
  .nullable()
  .transform((value) => (value === "" ? null : value));

export const serviceIdSchema = z.uuid();

const workflowsSchema = z
  .array(z.strictObject({ id: z.uuid(), isDefault: z.boolean() }))
  .superRefine((workflows, ctx) => {
    const defaults = workflows.flatMap((workflow, index) => (workflow.isDefault ? [index] : []));
    if (defaults.length === 0) {
      ctx.addIssue({ code: "custom", params: { code: "no_default" } });
    }
    for (const index of defaults.slice(1)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "isDefault"],
        params: { code: "many_defaults" },
      });
    }
    const seen = new Set<string>();
    workflows.forEach((workflow, index) => {
      if (seen.has(workflow.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          params: { code: "duplicate_workflow" },
        });
      }
      seen.add(workflow.id);
    });
  });

export const createServiceRequestSchema = z.strictObject({
  name: serviceName,
  description: description.optional(),
  workflows: workflowsSchema,
});

export const updateServiceRequestSchema = z
  .strictObject({
    name: serviceName,
    description,
    workflows: workflowsSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const listServicesQuerySchema = z.object({
  includeRetired: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
