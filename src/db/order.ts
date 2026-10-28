import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/**
 * Case-insensitive name order with the ICU root collation, so lists sort the same on every server whatever
 * its locale (glibc en_US ignores spaces, ICU does not), Arabic and English alike. Matches Intl.Collator("und").
 */
export function byName(column: AnyColumn): SQL {
  return sql`lower(${column}) collate "und-x-icu"`;
}
