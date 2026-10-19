import type express from "express";

/** Responses that carry tokens and identity must not be kept by any browser or proxy cache. */
export const noStore: express.RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};
