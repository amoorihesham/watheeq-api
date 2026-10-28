import { z } from 'zod';
import { contractChecksEnabled } from './checks.js';
import { AppError, DETAIL_CODES, type DetailCode, type ErrorDetail } from './errors.js';

const isDetailCode = (code: unknown): code is DetailCode => DETAIL_CODES.some((known) => known === code);

/**
 * A UUID from untrusted input, lower-cased: PostgreSQL accepts either case, but services compare ids as strings
 * (a stage's position against the rows locked for it), so an upper-case id would look unknown.
 */
export const idSchema = z.uuid().transform((id) => id.toLowerCase());

/** The refine option for "an update must change something"; reported as `no_fields`. */
export const NO_FIELDS = { params: { code: 'no_fields' } };

/**
 * One detail per problem, with a code the client can localize: zod's own code, `unknown_field` for each key a
 * strict schema does not accept (at its full path), or the `params.code` a refine names. A custom issue without a
 * registered code is a server bug, caught outside production.
 */
function detailsOf(issue: z.core.$ZodIssue): ErrorDetail[] {
  const path = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: path ? `${path}.${key}` : key,
      code: 'unknown_field',
    }));
  }
  const named = issue.code === 'custom' ? issue.params?.code : undefined;
  const code = typeof named === 'string' ? named : issue.code;
  if (contractChecksEnabled() && !isDetailCode(code)) {
    throw new Error(`detail code "${code}" at "${path}" is not in DETAIL_CODES`);
  }
  return [{ path, code: code as DetailCode }];
}

/** Parses untrusted input with a zod schema, or throws VALIDATION_FAILED with `{path, code}` details. */
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new AppError('VALIDATION_FAILED', result.error.issues.flatMap(detailsOf));
}
