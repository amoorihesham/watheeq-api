import { hash, verify } from "@node-rs/argon2";

// OWASP minimum for argon2id: 19 MiB of memory, 2 iterations, 1 lane. The algorithm defaults to argon2id.
const PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/** Returns false for a wrong password and for a malformed stored hash, never throws on bad input. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * A valid argon2id hash (same parameters) of a random password nobody knows.
 * Login verifies against it when the email does not exist, so unknown emails cost the same time as wrong passwords.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$eWPul0GindNkMPrbnycrWg$u9p80R/pP6Mk+S374/3kbEH/hcBF7PJQ6E164MT2WGk";
