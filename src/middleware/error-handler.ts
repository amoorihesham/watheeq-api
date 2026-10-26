import type { ErrorRequestHandler } from "express";
import { AppError, type ErrorDetail, fromDatabaseError } from "../http/errors.js";

interface ErrorBody {
  error: { code: string; requestId: string; details: ErrorDetail[] };
}

/**
 * Maps the client errors Express raises itself to our codes.
 * A path parameter that cannot be decoded is answered like any unknown ID. The body parser's errors are http-errors
 * (`expose` is set on client errors), mapped by status whatever their `type`; requiring `expose` keeps a library
 * error that merely has a `status` field a 500.
 */
function fromExpressError(err: unknown): AppError | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  const { status, expose, type } = err as { status?: unknown; expose?: unknown; type?: unknown };
  if (err instanceof URIError && status === 400) {
    return new AppError("NOT_FOUND");
  }
  if (expose !== true) {
    return undefined;
  }
  switch (status) {
    case 400:
      return new AppError(
        "VALIDATION_FAILED",
        type === "entity.parse.failed" ? [{ path: "", code: "invalid_json" }] : undefined,
      );
    case 413:
      return new AppError("PAYLOAD_TOO_LARGE");
    case 415:
      return new AppError("UNSUPPORTED_MEDIA_TYPE");
    default:
      return undefined;
  }
}

/**
 * The only place that writes error responses.
 * The body never contains a message or stack; unexpected errors are logged with their stack through pino-http.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const known = err instanceof AppError ? err : (fromExpressError(err) ?? fromDatabaseError(err));
  const resolved = known ?? new AppError("INTERNAL");
  if (!known) {
    // pino-http logs the response line at error level and serializes `res.err` with its stack.
    res.err = err instanceof Error ? err : new Error(String(err));
  }
  const body: ErrorBody = {
    error: { code: resolved.code, requestId: String(req.id), details: resolved.details ?? [] },
  };
  res.status(resolved.status).json(body);
};
