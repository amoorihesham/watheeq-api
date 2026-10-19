// Raw rows from `db.execute` carry timestamps as strings, so a query selects a timestamp as epoch milliseconds
// (`(extract(epoch from col) * 1000)::float8`, which the driver parses to a number) and the repository turns it into a Date here.

/** Epoch milliseconds from a raw row to a Date. Keeps `null` for a nullable timestamp column. */
export function dateFromEpochMs(ms: number): Date;
export function dateFromEpochMs(ms: number | null): Date | null;
export function dateFromEpochMs(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}
