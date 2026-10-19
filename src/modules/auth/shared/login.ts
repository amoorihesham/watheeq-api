import type { Db } from "../../../db/pool.js";
import { AppError } from "../../../http/errors.js";
import type { Logger } from "../../../logging/logger.js";
import { isIpBlocked, type LoginThrottleSettings, recordIpFailure } from "./ip-throttle.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./passwords.js";

/** What the shared login check needs to know about an account, in either realm. */
export interface LoginAccount {
  id: string;
  passwordHash: string;
  isActive: boolean;
  lockedUntil: Date | null;
}

export interface CredentialCheck<A extends LoginAccount> {
  /** "operator" or "tenant", for log lines only. */
  realm: string;
  ip: string;
  password: string;
  /** Looks the account up by its (already normalized) email. */
  find(): Promise<A | undefined>;
  /** Atomically counts one wrong password for the account and locks it at the limit. */
  recordWrongPassword(account: A): Promise<void>;
  log: Logger;
}

/**
 * The credential check shared by both realms (spec 4.3, "Tenant login", steps 2 to 6):
 * IP block, lookup, dummy-hash verification for unknown emails, account lock, password, active flag.
 * Returns the account only when the caller may go on to create a session.
 * Every 401 counts against the client IP; a success does not reset it, and a 429 is not counted again.
 */
export async function checkCredentials<A extends LoginAccount>(
  db: Db,
  settings: LoginThrottleSettings,
  check: CredentialCheck<A>,
): Promise<A> {
  const { realm, ip, log } = check;
  const fail = async (reason: string, accountId?: string): Promise<never> => {
    log.warn({ reason, subjectId: accountId }, `${realm} login failed`);
    await recordIpFailure(db, ip, settings);
    throw new AppError("INVALID_CREDENTIALS");
  };

  if (await isIpBlocked(db, ip, settings)) {
    log.warn({ reason: "ip_blocked" }, `${realm} login throttled`);
    throw new AppError("TOO_MANY_ATTEMPTS");
  }

  const account = await check.find();
  if (!account) {
    // Unknown email: verify against a dummy hash so the response time matches a wrong password.
    await verifyPassword(DUMMY_PASSWORD_HASH, check.password);
    return fail("unknown_email");
  }

  if (account.lockedUntil !== null && account.lockedUntil.getTime() > Date.now()) {
    log.warn({ reason: "account_locked", subjectId: account.id }, `${realm} login throttled`);
    throw new AppError("TOO_MANY_ATTEMPTS");
  }

  if (!(await verifyPassword(account.passwordHash, check.password))) {
    await check.recordWrongPassword(account);
    return fail("wrong_password", account.id);
  }
  if (!account.isActive) {
    return fail("inactive", account.id);
  }
  return account;
}
