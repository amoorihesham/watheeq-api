/** PostgreSQL SQLSTATEs the application translates (src/http/errors.ts). */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** Drizzle wraps the driver error and keeps the PostgreSQL error as `cause`. */
function pgErrorOf(err: unknown): { code?: string; constraint?: string } | null | undefined {
  return ((err as { cause?: unknown } | null | undefined)?.cause ?? err) as { code?: string; constraint?: string } | null | undefined;
}

/** The constraint name of a PostgreSQL unique violation, or undefined for any other error. */
export function uniqueViolationConstraint(err: unknown): string | undefined {
  const pgError = pgErrorOf(err);
  return pgError?.code === UNIQUE_VIOLATION ? pgError.constraint : undefined;
}

/** The constraint name of a PostgreSQL foreign-key violation, or undefined for any other error. */
export function foreignKeyViolationConstraint(err: unknown): string | undefined {
  const pgError = pgErrorOf(err);
  return pgError?.code === FOREIGN_KEY_VIOLATION ? pgError.constraint : undefined;
}
