import { pinoHttp } from "pino-http";
import { genReqId } from "../http/request-id.js";
import type { Logger } from "./logger.js";

/**
 * Request logging. `quietReqLogger` makes `req.log` carry `reqId` instead of the full request,
 * and the response line carries both `reqId` and the request. Every line therefore has `reqId`.
 */
export function httpLogger(logger: Logger) {
  return pinoHttp({ logger, genReqId, quietReqLogger: true });
}
