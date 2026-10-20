import type express from "express";
import { AppError } from "../http/errors.js";
import type { AuditContext } from "./audit.js";

/** Only valid behind `requireOperator` or `requireUser`. */
export function auditContext(req: express.Request): AuditContext {
  const requestId = String(req.id);
  if (req.operatorAuth) {
    return { actor: { type: "operator", id: req.operatorAuth.operator.id }, requestId };
  }
  if (req.userAuth) {
    return { actor: { type: "user", id: req.userAuth.user.id }, requestId };
  }
  throw new AppError("UNAUTHENTICATED");
}
