import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_HASH_PARAMS } from '../auth.constants.js';

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_PARAMS);
}

/** Returns false for a wrong password and for a malformed stored hash, never throws on bad input. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
