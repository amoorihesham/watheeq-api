import pino, { type DestinationStream, type Logger } from "pino";

// content-disposition carries the name of a downloaded file, which may hold personal data (Phase 5.5 spec, section 6).
const REDACTED_FIELDS = [
  "password",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "authorization",
  "content-disposition",
];

/** Redacts the sensitive field names at the top level, one level deep, and inside logged request/response headers. */
export const REDACT_PATHS = [
  ...REDACTED_FIELDS.map((field) => `["${field}"]`),
  ...REDACTED_FIELDS.map((field) => `*["${field}"]`),
  ...REDACTED_FIELDS.map((field) => `req.headers["${field}"]`),
  ...REDACTED_FIELDS.map((field) => `res.headers["${field}"]`),
];

/** JSON to stdout (data residency: no external log service). A destination can be injected for tests. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[Redacted]" } }, destination);
}

export type { Logger };
