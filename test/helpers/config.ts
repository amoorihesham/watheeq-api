import { type Config, parseConfig } from "../../src/config/config.js";

export const TEST_APP_BASE_URL = "http://app.watheeq.test";
export const TEST_JWT_SECRET = "test-only-jwt-secret-at-least-32-characters";

/** Validated configuration with all defaults, for tests. Overrides are raw environment strings. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  const result = parseConfig({
    DATABASE_URL: "postgres://unused@localhost/unused",
    JWT_SECRET: TEST_JWT_SECRET,
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    EMAIL_FROM: "Watheeq Test <no-reply@watheeq.test>",
    APP_BASE_URL: TEST_APP_BASE_URL,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.config;
}
