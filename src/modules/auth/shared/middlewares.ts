import type { Request, RequestHandler } from "express";
import { AppError } from "@/http/errors.js";
import { ACCESS_COOKIE } from "../auth.constants.js";
import type { AuthUserType, UserRoleType } from "../auth.types.js";
import { verifyAccessToken } from "./tokens.js";

/** Verifies the access-token cookie and attaches the user. Reads no database row (Phase 0 spec, 4.3). */
export function authenticate(jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    const user = typeof token === "string" ? await verifyAccessToken(token, jwtSecret) : null;
    if (!user) {
      throw new AppError("UNAUTHENTICATED");
    }
    req.auth = user;
    next();
  };
}

/** Mount after `authenticate()`. */
export function requireRole(role: UserRoleType): RequestHandler {
  return (req, _res, next) => {
    if (principalOf(req).role !== role) {
      throw new AppError("FORBIDDEN");
    }
    next();
  };
}

/** The authenticated user; a route that reaches this without `authenticate()` is a wiring bug, answered with 401. */
export function principalOf(req: Request): AuthUserType {
  if (!req.auth) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.auth;
}
