import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import { MAX_UNIT_NAME_LENGTH } from "./org.config.js";

const unitName = z.string().trim().min(1).max(MAX_UNIT_NAME_LENGTH);

export const unitIdSchema = z.uuid();

// No parent creates a department; a department parent creates a section (R2.2).
export const createUnitRequestSchema = z.strictObject({
  name: unitName,
  parentId: z.uuid().optional(),
});

// A section can move to another department, but never become a department (R2.4), so parentId is never null.
export const updateUnitRequestSchema = z
  .strictObject({ name: unitName, parentId: z.uuid() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);
