/** PostgreSQL SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * True if the error is a PostgreSQL unique-constraint violation.
 * Drizzle wraps the driver error and keeps the PostgreSQL error as `cause`.
 */
export function isUniqueViolation(err: unknown): boolean {
  const pgError = (err as { cause?: unknown } | null | undefined)?.cause ?? err;
  return (pgError as { code?: string } | null | undefined)?.code === UNIQUE_VIOLATION;
}
