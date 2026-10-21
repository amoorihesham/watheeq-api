/** PostgreSQL SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * The constraint name of a PostgreSQL unique violation, or undefined for any other error.
 * Drizzle wraps the driver error and keeps the PostgreSQL error as `cause`.
 */
export function uniqueViolationConstraint(err: unknown): string | undefined {
  const pgError = ((err as { cause?: unknown } | null | undefined)?.cause ?? err) as
    | { code?: string; constraint?: string }
    | null
    | undefined;
  return pgError?.code === UNIQUE_VIOLATION ? pgError.constraint : undefined;
}
