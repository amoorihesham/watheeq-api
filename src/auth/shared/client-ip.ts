import { isIP } from "node:net";
import type { Request } from "express";

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Stand-in when no valid address is available, so throttling still has a row to count on. */
const UNKNOWN_IP = "0.0.0.0";

function normalize(address: string | undefined): string | undefined {
  if (address === undefined) {
    return undefined;
  }
  const candidate = IPV4_MAPPED.exec(address)?.[1] ?? address;
  return isIP(candidate) === 0 ? undefined : candidate;
}

/**
 * The client IP as Express resolves it under the `trust proxy` setting (`TRUST_PROXY`),
 * so only hops added by trusted proxies count and a client-supplied X-Forwarded-For entry cannot change it.
 * IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are stored as plain IPv4, so one client is one throttle row.
 * The result is always a valid address, because it is stored in an `inet` column.
 */
export function clientIp(req: Request): string {
  return normalize(req.ip) ?? normalize(req.socket.remoteAddress) ?? UNKNOWN_IP;
}
