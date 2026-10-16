import type { Request, RequestHandler } from "express";
import { AppError } from "../../http/errors.js";
import { readCookie } from "./cookies.js";
import { CSRF_HEADER, csrfTokenMatches, isUnsafeMethod } from "./csrf.js";
import { hashToken, isWellFormedToken } from "./tokens.js";

/** `last_seen_at` is rewritten at most once per minute per session (spec 4.3, "Request authentication"). */
export const LAST_SEEN_RESOLUTION_MS = 60_000;

export interface ResolvedSession<P> {
  sessionId: string;
  lastSeenAt: Date;
  principal: P;
}

/** What differs per realm: the cookie, the session lookup, and where the result is attached. */
export interface SessionAuthOptions<P> {
  cookieName: string;
  /** Returns the session only if it is valid: not revoked, not expired, not idle-expired, principal active. */
  resolve(tokenHash: Buffer): Promise<ResolvedSession<P> | undefined>;
  /** Marks the session as seen now. Must be safe to call concurrently. */
  touch(sessionId: string): Promise<void>;
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
      await options.touch(session.sessionId);
    }
    if (isUnsafeMethod(req.method) && !csrfTokenMatches(req.get(CSRF_HEADER), token)) {
      throw new AppError("CSRF_FAILED");
    }
    options.attach(req, { sessionId: session.sessionId, principal: session.principal });
    next();
  };
}
