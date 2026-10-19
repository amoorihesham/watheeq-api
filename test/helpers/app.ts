import type express from "express";
import type pg from "pg";
import { buildApp } from "../../src/app.js";
import type { Logger } from "../../src/logging/logger.js";
import { testConfig } from "./config.js";

export interface TestAppOptions {
  /** Raw environment strings layered over the defaults, as in `testConfig`. */
  config?: Record<string, string>;
  /** Extra routers mounted after the body parser, to exercise error paths. */
  routers?: express.Router[];
}

/** The real application, built against the given pool and logger with test configuration. */
export function testApp(
  pool: pg.Pool,
  logger: Logger,
  options: TestAppOptions = {},
): express.Express {
  return buildApp({
    pool,
    logger,
    config: testConfig(options.config),
    ...(options.routers ? { routers: options.routers } : {}),
  });
}
