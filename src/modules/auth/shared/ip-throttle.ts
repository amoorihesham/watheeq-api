import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../../../db/pool.js";

export interface LoginThrottleSettings {
  accountMaxFailures: number;
  accountLockSeconds: number;
  ipMaxFailures: number;
  ipWindowSeconds: number;
}

/**
 * The row key for a client IP (decision P0.24): an IPv4 address as is, an IPv6 address as its /64 network.
 * One IPv6 customer usually holds a whole /64, so counting full addresses would let an attacker
 * rotate through 2^64 addresses and never reach the limit.
 */
function throttleKey(ip: string): SQL {
  return sql`(case when family(${ip}::inet) = 6 then network(set_masklen(${ip}::inet, 64))::inet else ${ip}::inet end)`;
}

/** True if this IP has reached the failure limit in its current window. A stale window counts as zero. */
export async function isIpBlocked(
  db: Db,
  ip: string,
  settings: LoginThrottleSettings,
): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 from login_ip_throttle
    where ip = ${throttleKey(ip)}
      and failed_count >= ${settings.ipMaxFailures}
      and window_started_at > now() - make_interval(secs => ${settings.ipWindowSeconds})
  `);
  return result.rows.length > 0;
}

/**
 * Counts one failed login for this IP in a single atomic statement (no read-then-write):
 * a new row starts a window, an existing row inside its window is incremented,
 * and an existing row whose window is stale starts a new window at 1.
 */
export async function recordIpFailure(
  db: Db,
  ip: string,
  settings: LoginThrottleSettings,
): Promise<void> {
  await db.execute(sql`
    insert into login_ip_throttle as t (ip, failed_count, window_started_at)
    values (${throttleKey(ip)}, 1, now())
    on conflict (ip) do update set
      failed_count = case
        when t.window_started_at <= now() - make_interval(secs => ${settings.ipWindowSeconds}) then 1
        else t.failed_count + 1
      end,
      window_started_at = case
        when t.window_started_at <= now() - make_interval(secs => ${settings.ipWindowSeconds}) then now()
        else t.window_started_at
      end
  `);
}
