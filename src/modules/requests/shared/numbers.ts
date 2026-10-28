import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/pool.js';
import { SUBSCRIPTION_TIME_ZONE } from '@/modules/subscriptions/index.js';

/**
 * The next number of a prefix for the tenant in the current Riyadh year (Phase 6 spec, 4.1). The upsert takes the
 * counter row's lock, so concurrent submissions count one after the other, and a rollback undoes the increment, so
 * numbers have no gaps. `at` fixes the clock for tests; production uses the database's.
 */
export async function nextNumber(tx: Tx, tenantId: string, prefix: string, at?: Date): Promise<{ year: number; number: number }> {
  const instant = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`;
  const zone = sql.raw(`'${SUBSCRIPTION_TIME_ZONE}'`);
  const { rows } = await tx.execute<{ year: number; last_value: number }>(sql`
    insert into number_sequences (tenant_id, prefix, year, last_value)
    values (${tenantId}, ${prefix}, extract(year from ${instant} at time zone ${zone})::int, 1)
    on conflict (tenant_id, prefix, year) do update set last_value = number_sequences.last_value + 1
    returning year::int as year, last_value`);
  const [row] = rows;
  if (!row) {
    throw new Error('the number sequence returned no row');
  }
  return { year: row.year, number: row.last_value };
}
