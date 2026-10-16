import express from "express";
import { AppError } from "./errors.js";

export const BODY_LIMIT = "100kb";

/** Rejects a request that carries a body without `Content-Type: application/json`. */
const requireJsonBody: express.RequestHandler = (req, _res, next) => {
  const length = Number(req.headers["content-length"] ?? 0);
  const hasBody = length > 0 || req.headers["transfer-encoding"] !== undefined;
  if (hasBody && !req.is("application/json")) {
    next(new AppError("UNSUPPORTED_MEDIA_TYPE"));
    return;
  }
  next();
};

/** JSON-only body handling with a size limit. Errors flow to the central error handler. */
export function jsonBody(): express.RequestHandler[] {
  return [requireJsonBody, express.json({ limit: BODY_LIMIT })];
}

export const notFoundHandler: express.RequestHandler = (_req, _res, next) => {
  next(new AppError("NOT_FOUND"));
};
