import type { Request } from "express";
import { AppError } from "../../../http/errors.js";
import { readCookie } from "./cookies.js";
import { csrfTokenFor } from "./csrf.js";

/**
 * The CSRF token behind a realm's `/session` endpoint.
 * The browser app keeps the CSRF token in memory and recovers it here after a reload.
 * It is derived from the session cookie, so it is the same token login returned.
 */
export function csrfTokenFromSessionCookie(req: Request, cookieName: string): string {
  const sessionToken = readCookie(req, cookieName);
  if (sessionToken === undefined) {
    throw new AppError("UNAUTHENTICATED");
  }
  return csrfTokenFor(sessionToken);
}
