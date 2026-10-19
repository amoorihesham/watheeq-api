import type { Request } from "express";
import { z } from "zod";
import { validate } from "../../../http/validate.js";
import { clientIp } from "./client-ip.js";
import { readCookie } from "./cookies.js";
import { hashToken, isWellFormedToken } from "./tokens.js";

// Passwords are checked against a 256-character cap before any hashing work (spec section 5).
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});

const USER_AGENT_MAX_LENGTH = 512;

/** What both realms' login endpoints read from the request. */
export interface LoginRequest {
  /** Already normalized (trimmed, lower-cased). */
  email: string;
  password: string;
  ip: string;
  userAgent: string | undefined;
  /** Hash of the realm's session cookie as the browser presented it, if it was well formed. */
  presentedTokenHash: Buffer | undefined;
}

/**
 * Validates the login body and reads the client IP, user agent, and presented session cookie.
 * The presented cookie is only hashed, never trusted: login revokes that session and issues a new token,
 * so a token planted before login (fixation) never becomes a logged-in session.
 */
export function readLoginRequest(req: Request, cookieName: string): LoginRequest {
  const { email, password } = validate(loginBody, req.body);
  const presented = readCookie(req, cookieName);
  return {
    email,
    password,
    ip: clientIp(req),
    userAgent: req.get("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH),
    presentedTokenHash:
      presented !== undefined && isWellFormedToken(presented) ? hashToken(presented) : undefined,
  };
}
