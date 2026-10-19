import type { Request, Response } from "express";

// One cookie per realm, so a session of one realm is never read by the other (T6). The `__Host-` prefix requires Secure, Path=/, and no Domain.
export const OPERATOR_COOKIE = "__Host-wq_operator";
export const TENANT_COOKIE = "__Host-wq_session";

const COOKIE_FLAGS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

/**
 * Reads one cookie by exact name from the Cookie header.
 * Auth needs a single cookie per realm, so this avoids a cookie-parsing dependency.
 * If a name is repeated, the first occurrence wins (browsers send the most specific path first).
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** A browser-session cookie (no Max-Age): the server enforces idle and absolute expiry. The `__Host-` prefix requires Secure, Path=/, and no Domain. */
export function setSessionCookie(res: Response, name: string, token: string): void {
  res.cookie(name, token, COOKIE_FLAGS);
}

export function clearSessionCookie(res: Response, name: string): void {
  res.clearCookie(name, COOKIE_FLAGS);
}
