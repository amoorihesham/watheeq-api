import type { ErrorRequestHandler } from "express";
import { AppError, type ErrorDetail } from "./errors.js";

interface ErrorBody {
  error: { code: string; requestId: string; details?: ErrorDetail[] };
}

/** Maps errors raised by Express's body parser (http-errors with a `type`) to our codes. */
function fromBodyParserError(err: unknown): AppError | undefined {
  const type =
    typeof err === "object" && err !== null ? (err as { type?: unknown }).type : undefined;
  switch (type) {
    case "entity.parse.failed":
      return new AppError("VALIDATION_FAILED");
    case "entity.too.large":
      return new AppError("PAYLOAD_TOO_LARGE");
    case "charset.unsupported":
    case "encoding.unsupported":
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
  const known = err instanceof AppError ? err : fromBodyParserError(err);
  const resolved = known ?? new AppError("INTERNAL");
  if (!known) {
    // pino-http logs the response line at error level and serializes `res.err` with its stack.
    res.err = err instanceof Error ? err : new Error(String(err));
  }
  const body: ErrorBody = { error: { code: resolved.code, requestId: String(req.id) } };
  if (resolved.code === "VALIDATION_FAILED" && resolved.details) {
    body.error.details = resolved.details;
  }
  res.status(resolved.status).json(body);
};
