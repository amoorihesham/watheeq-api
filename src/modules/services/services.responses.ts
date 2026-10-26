import { z } from "zod";

const fieldBase = {
  id: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  required: z.boolean(),
};

const option = z.strictObject({ id: z.string(), label: z.string() });

const plainField = (type: "short_text" | "long_text" | "date" | "yes_no") =>
  z.strictObject({ ...fieldBase, type: z.literal(type) });

const choiceField = (type: "single_choice" | "multiple_choice") =>
  z.strictObject({ ...fieldBase, type: z.literal(type), options: z.array(option) });

/** A form field keeps the settings of its type, as the form is saved (every setting of the type is required). */
export const formFieldResponseSchema = z.discriminatedUnion("type", [
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
  z.strictObject({ ...fieldBase, type: z.literal("file"), maxFiles: z.number() }),
]);

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
