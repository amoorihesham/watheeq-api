import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** 256 random bits, base64url (43 characters). Used for session tokens; CSRF tokens are derived from them (csrf.ts). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** True if the value has the shape of a token we issue. Anything else cannot match a stored hash. */
export function isWellFormedToken(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}

/** SHA-256 of a token. Only this is stored, so a database leak does not yield usable cookies (P0.5). */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function hashesEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
