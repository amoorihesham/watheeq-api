import { z } from 'zod';

/**
 * The pieces every list query schema is built from (Phase 8 spec 4.2.4): `z.object({...filters, ...pageQuery})`.
 * The defaults live here, so the fingerprint of a cursor, the docs, and the query agree. A value a filter does not
 * accept is reported as `invalid_value` at the filter's path.
 */

const INVALID_VALUE = { params: { code: 'invalid_value' } };

export const booleanFilter = (defaultValue: 'true' | 'false' | 'all') => z.enum(['true', 'false', 'all']).default(defaultValue);

export function valueFilter<const V extends readonly [string, ...string[]]>(values: V, defaultValue: V[number] | 'all'): z.ZodDefault<z.ZodEnum<{ [K in V[number] | 'all']: K }>> {
  // TypeScript cannot follow the enum's mapped type through a generic tuple, so the schema is built untyped.
  const options: [string, ...string[]] = [...values, 'all'];
  return z.enum(options).default(defaultValue) as never;
}

/** An ID (lower-cased like `idSchema`, T37), `all`, or `none` for the items where the field is empty. */
export const idFilter = ({ none }: { none: boolean }) =>
  z
    .unknown()
    .default('all')
    .transform((value, ctx): string => {
      if (typeof value === 'string') {
        if (value === 'all' || (none && value === 'none')) {
          return value;
        }
        if (z.uuid().safeParse(value).success) {
          return value.toLowerCase();
        }
      }
      ctx.addIssue({ code: 'custom', ...INVALID_VALUE });
      return z.NEVER;
    })
    // The unknown input and the transform have no JSON Schema type, so the document needs it stated.
    .meta({
      type: 'string',
      description: none ? 'A UUID, `all`, or `none` for the items where it is empty.' : 'A UUID or `all`.',
    });

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const pageQuery = {
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

/** Trimmed text; a blank one becomes `null` (R8.13). Callers add `.optional()` when a PATCH may leave it out. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));
