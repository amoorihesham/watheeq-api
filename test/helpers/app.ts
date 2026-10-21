import type express from "express";
import type pg from "pg";
import { buildApp } from "../../src/app.js";
import type { EmailSenderType } from "../../src/email/index.js";
import type { Logger } from "../../src/logging/logger.js";
import { testConfig } from "./config.js";
import { createFakeEmailSender } from "./email.js";

export interface TestAppOptions {
  /** Raw environment strings layered over the defaults, as in `testConfig`. */
  config?: Record<string, string>;
  /** Extra routers mounted after the body parser, to exercise error paths. */
  routers?: express.Router[];
  /** Defaults to a fake that drops every email, so tests never reach an SMTP server. */
  emailSender?: EmailSenderType;
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
    emailSender: options.emailSender ?? createFakeEmailSender().sender,
    ...(options.routers
      ? { routers: options.routers.map((router) => ({ prefix: "/", router })) }
      : {}),
  });
}
