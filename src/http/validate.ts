import type { z } from "zod";
import { AppError, type ErrorDetail } from "./errors.js";

/** The refine option for "an update must change something"; reported as `no_fields`. */
export const NO_FIELDS = { params: { code: "no_fields" } };

/**
 * One detail per problem, with a code the client can localize: zod's own code, `unknown_field` for each key a
 * strict schema does not accept (at its full path), or the `params.code` a refine names.
 */
function detailsOf(issue: z.core.$ZodIssue): ErrorDetail[] {
  const path = issue.path.join(".");
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: path ? `${path}.${key}` : key,
      code: "unknown_field",
    }));
  }
  const named = issue.code === "custom" ? issue.params?.code : undefined;
  return [{ path, code: typeof named === "string" ? named : issue.code }];
}

/** Parses untrusted input with a zod schema, or throws VALIDATION_FAILED with `{path, code}` details. */
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new AppError("VALIDATION_FAILED", result.error.issues.flatMap(detailsOf));
}
