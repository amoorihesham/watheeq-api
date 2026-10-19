import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pinoHttp } from "pino-http";
import type { Logger } from "../logging/logger.js";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Uses the client's X-Request-Id only if it is a safe, short token, so log content is never attacker-shaped.
 * Otherwise generates a UUID. Echoes the chosen ID in the response header.
 */
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}

/**
 * Request logging. `quietReqLogger` makes `req.log` carry `reqId` instead of the full request,
 * and the response line carries both `reqId` and the request. Every line therefore has `reqId`.
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({ logger, genReqId, quietReqLogger: true });
}
