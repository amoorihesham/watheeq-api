import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../logging/logger.js';

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Uses the client's X-Request-Id only if it is a safe, short token, so log content is never attacker-shaped.
 * Otherwise generates a UUID. Echoes the chosen ID in the response header.
 */
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * The logged request without its query string: a query may carry personal data, such as the name of an uploaded
 * file (`POST /files?name=...`), which logs never hold (Phase 5.5 spec, section 6).
 */
function withoutQuery<T extends { url: string }>(req: T): T {
  const { query: _query, ...rest } = req as T & { query?: unknown };
  return { ...rest, url: req.url.split('?')[0] ?? '' } as T;
}

/**
 * Request logging. `quietReqLogger` makes `req.log` carry `reqId` instead of the full request,
 * and the response line carries both `reqId` and the request. Every line therefore has `reqId`.
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId,
    quietReqLogger: true,
    serializers: { req: withoutQuery },
  });
}
