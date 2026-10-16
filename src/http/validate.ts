import type { z } from "zod";
import { AppError } from "./errors.js";

/** Parses untrusted input with a zod schema, or throws VALIDATION_FAILED with `{path, code}` details. */
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new AppError(
    "VALIDATION_FAILED",
    result.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
  );
}
