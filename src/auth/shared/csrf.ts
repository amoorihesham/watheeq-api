import { createHmac } from "node:crypto";
import { hashesEqual, isWellFormedToken } from "./tokens.js";

export const CSRF_HEADER = "x-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * The CSRF token is HMAC-SHA256 keyed by the session token (decision P0.6).
 * It is stable for the life of the session, so every tab and every reload gets the same token,
 * and nothing is stored. Another site cannot compute it without the httpOnly session cookie,
 * and the token does not reveal the session token.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", sessionToken).update("csrf").digest("base64url");
}

/** Compares the presented header with the token derived from this request's session token, in constant time. */
export function csrfTokenMatches(presented: unknown, sessionToken: string): boolean {
  if (typeof presented !== "string" || !isWellFormedToken(presented)) {
    return false;
  }
  return hashesEqual(Buffer.from(presented), Buffer.from(csrfTokenFor(sessionToken)));
}
