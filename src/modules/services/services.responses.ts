import { z } from "zod";
import { FIELD_TYPES } from "./services.constants.js";

const option = z.strictObject({ id: z.string(), label: z.string() });

/** A form field: every setting of every type, `null` where the field's type has none (R8.4). */
export const formFieldResponseSchema = z.strictObject({
  id: z.string(),
  type: z.enum(FIELD_TYPES),
  label: z.string(),
  helpText: z.string().nullable(),
  required: z.boolean(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  integer: z.boolean().nullable(),
  options: z.array(option).nullable(),
  maxFiles: z.number().nullable(),
});

export const serviceResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  retired: z.boolean(),
  form: z.strictObject({ revision: z.number(), fields: z.array(formFieldResponseSchema) }),
  workflows: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      isDefault: z.boolean(),
      retired: z.boolean(),
    }),
  ),
});
