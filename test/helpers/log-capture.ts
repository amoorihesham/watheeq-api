import { Writable } from "node:stream";
import { createLogger, type Logger } from "../../src/logging/logger.js";

export interface LogCapture {
  logger: Logger;
  lines: () => Record<string, unknown>[];
}

/** A real pino logger (with the production redaction rules) writing JSON lines into memory. */
export function captureLogs(level = "info"): LogCapture {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: createLogger(level, destination),
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
