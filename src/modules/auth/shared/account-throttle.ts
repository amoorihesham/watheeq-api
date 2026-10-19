import { sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { LoginThrottleSettings } from "./ip-throttle.js";

interface ThrottledAccountColumns {
  failedLoginCount: AnyPgColumn;
  lockedUntil: AnyPgColumn;
}

/**
 * The SET clause for one wrong password, for `users` and `operators` alike.
 * It is meant for a single UPDATE statement: every expression reads the row as it was before the update,
 * and concurrent updates of the row queue on its lock, so no increment is lost.
 * At the limit the account is locked and the count starts over.
 */
export function wrongPasswordUpdate(
  table: ThrottledAccountColumns & PgTable,
  settings: LoginThrottleSettings,
) {
  const reachesLimit = sql`${table.failedLoginCount} + 1 >= ${settings.accountMaxFailures}`;
  return {
    failedLoginCount: sql`case when ${reachesLimit} then 0 else ${table.failedLoginCount} + 1 end`,
    lockedUntil: sql`case when ${reachesLimit} then now() + make_interval(secs => ${settings.accountLockSeconds}) else ${table.lockedUntil} end`,
  };
}

/** The SET clause for a successful login: the count starts over and any expired lock is cleared. */
export const successfulLoginUpdate = { failedLoginCount: 0, lockedUntil: null } as const;
