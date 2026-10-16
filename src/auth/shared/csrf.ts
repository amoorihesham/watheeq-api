import { hashesEqual, hashToken, isWellFormedToken } from "./tokens.js";

export const CSRF_HEADER = "x-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/** Compares the SHA-256 of the presented token with the stored hash in constant time. */
export function csrfTokenMatches(presented: unknown, storedHash: Buffer): boolean {
  if (typeof presented !== "string" || !isWellFormedToken(presented)) {
    return false;
  }
  return hashesEqual(hashToken(presented), storedHash);
}
