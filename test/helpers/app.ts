import type express from 'express';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import type { EmailSenderType } from '../../src/email/index.js';
import type { Logger } from '../../src/logging/logger.js';
import type { PlatformPermissionsOfType } from '../../src/modules/platform-access/index.js';
import type { FileStoreType } from '../../src/storage/index.js';
import { testConfig } from './config.js';
import { createFakeEmailSender } from './email.js';
import { connectToTestStore } from './storage.js';

export interface TestAppOptions {
  /** Raw environment strings layered over the defaults, as in `testConfig`. */
  config?: Record<string, string>;
  /** Extra routers mounted after the body parser, to exercise error paths. */
  routers?: express.Router[];
  /** Defaults to a fake that drops every email, so tests never reach an SMTP server. */
  emailSender?: EmailSenderType;
  /** Defaults to the real S3-compatible server of the test run; tests pass a wrapper to fail or pause it. */
  fileStore?: FileStoreType;
  /** Replaces what each operator holds, for both the session and the operator routes (R11.12). */
  platformPermissionsOf?: PlatformPermissionsOfType;
}

/** The real application, built against the given pool and logger with test configuration. */
export function testApp(pool: pg.Pool, logger: Logger, options: TestAppOptions = {}): express.Express {
  return buildApp({
    pool,
    logger,
    config: testConfig(options.config),
    emailSender: options.emailSender ?? createFakeEmailSender().sender,
    fileStore: options.fileStore ?? connectToTestStore(),
    ...(options.platformPermissionsOf ? { platformPermissionsOf: options.platformPermissionsOf } : {}),
    ...(options.routers ? { routers: options.routers.map((router) => ({ prefix: '/', router })) } : {}),
  });
}
