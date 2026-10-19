import type { Request, RequestHandler } from "express";
import { AppError } from "../http/errors.js";
import { readCookie } from "../modules/auth/shared/cookies.js";
import { CSRF_HEADER, csrfTokenMatches, isUnsafeMethod } from "../modules/auth/shared/csrf.js";
import { LAST_SEEN_RESOLUTION_MS, type ResolvedSession } from "../modules/auth/shared/session.js";
import { hashToken, isWellFormedToken } from "../modules/auth/shared/tokens.js";

/** What differs per realm: the cookie, the session lookup, and where the result is attached. */
export interface SessionAuthOptions<P> {
  cookieName: string;
  /** Returns the session only if it is valid: not revoked, not expired, not idle-expired, principal active. */
  resolve(tokenHash: Buffer): Promise<ResolvedSession<P> | undefined>;
  /** Marks the session as seen now. Must be safe to call concurrently. Gets the principal so a realm can pick its transaction (tenant). */
  touch(session: { sessionId: string; principal: P }): Promise<void>;
  attach(req: Request, session: { sessionId: string; principal: P }): void;
}

/**
 * The request-authentication steps shared by both realms:
 * read this realm's cookie only, resolve the session, bound `last_seen_at` writes, enforce CSRF on unsafe methods.
 */
export function sessionAuth<P>(options: SessionAuthOptions<P>): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, options.cookieName);
    if (token === undefined || !isWellFormedToken(token)) {
      throw new AppError("UNAUTHENTICATED");
    }
    const session = await options.resolve(hashToken(token));
    if (!session) {
      throw new AppError("UNAUTHENTICATED");
    }
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await options.touch(session);
    }
    if (isUnsafeMethod(req.method) && !csrfTokenMatches(req.get(CSRF_HEADER), token)) {
      throw new AppError("CSRF_FAILED");
    }
    options.attach(req, { sessionId: session.sessionId, principal: session.principal });
    next();
  };
}
