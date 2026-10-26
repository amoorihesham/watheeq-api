import { z } from "zod";
import { booleanFilter, optionalText, pageQuery } from "@/http/filters.js";
import { idSchema, NO_FIELDS } from "@/http/validate.js";
import {
  MAX_FIELD_HELP_TEXT_LENGTH,
  MAX_FIELD_LABEL_LENGTH,
  MAX_FILES_PER_FIELD,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS_PER_FIELD,
  MAX_SERVICE_DESCRIPTION_LENGTH,
  MAX_SERVICE_NAME_LENGTH,
} from "./services.config.js";

const serviceName = z.string().trim().min(1).max(MAX_SERVICE_NAME_LENGTH);

// A blank description is no description.
const description = optionalText(MAX_SERVICE_DESCRIPTION_LENGTH);

export const serviceIdSchema = idSchema;

const workflowsSchema = z
  .array(z.strictObject({ id: idSchema, isDefault: z.boolean() }))
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
  retired: booleanFilter("false"),
  ...pageQuery,
});

const label = (max: number) => z.string().trim().min(1).max(max);

const fieldBase = {
  id: idSchema.optional(),
  label: label(MAX_FIELD_LABEL_LENGTH),
  // A blank help text is no help text.
  helpText: optionalText(MAX_FIELD_HELP_TEXT_LENGTH)
    .optional()
    .transform((value) => value ?? null),
  required: z.boolean(),
};

const optionSchema = z.strictObject({
  id: idSchema.optional(),
  label: label(MAX_OPTION_LABEL_LENGTH),
});

const choiceOptions = z.array(optionSchema).min(1).max(MAX_OPTIONS_PER_FIELD);

const plainField = (type: "short_text" | "long_text" | "date" | "yes_no") =>
  z.strictObject({ ...fieldBase, type: z.literal(type) });

const choiceField = (type: "single_choice" | "multiple_choice") =>
  z.strictObject({ ...fieldBase, type: z.literal(type), options: choiceOptions });

const formFieldSchema = z.discriminatedUnion("type", [
  plainField("short_text"),
  plainField("long_text"),
  plainField("date"),
  plainField("yes_no"),
  z.strictObject({
    ...fieldBase,
    type: z.literal("number"),
    min: z.number().nullable(),
    max: z.number().nullable(),
    integer: z.boolean(),
  }),
  choiceField("single_choice"),
  choiceField("multiple_choice"),
  z.strictObject({
    ...fieldBase,
    type: z.literal("file"),
    maxFiles: z.int().min(1).max(MAX_FILES_PER_FIELD),
  }),
]);

/** Adds an issue at the second and later places a (case-folded) value is used. */
function flagRepeats(
  ctx: z.RefinementCtx,
  values: { value: string | undefined; path: (string | number)[] }[],
  code: string,
) {
  const seen = new Set<string>();
  for (const { value, path } of values) {
    if (value === undefined) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", path, params: { code } });
    }
    seen.add(key);
  }
}

export const updateServiceFormRequestSchema = z.strictObject({
  baseRevision: z.int().min(0),
  fields: z.array(formFieldSchema).superRefine((fields, ctx) => {
    flagRepeats(
      ctx,
      fields.map((field, index) => ({ value: field.label, path: [index, "label"] })),
      "duplicate_label",
    );
    flagRepeats(
      ctx,
      fields.map((field, index) => ({ value: field.id, path: [index, "id"] })),
      "duplicate_field_id",
    );
    fields.forEach((field, index) => {
      if (
        field.type === "number" &&
        field.min !== null &&
        field.max !== null &&
        field.min > field.max
      ) {
        ctx.addIssue({ code: "custom", path: [index, "min"], params: { code: "min_above_max" } });
      }
      if (field.type === "single_choice" || field.type === "multiple_choice") {
        flagRepeats(
          ctx,
          field.options.map((option, at) => ({
            value: option.label,
            path: [index, "options", at, "label"],
          })),
          "duplicate_option",
        );
        flagRepeats(
          ctx,
          field.options.map((option, at) => ({
            value: option.id,
            path: [index, "options", at, "id"],
          })),
          "duplicate_option",
        );
      }
    });
  }),
});
