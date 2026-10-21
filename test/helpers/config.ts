import { type Config, parseConfig } from "../../src/config/config.js";

export const TEST_JWT_SECRET = "test-only-jwt-secret-at-least-32-characters";

/** Validated configuration with all defaults, for tests. Overrides are raw environment strings. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  const result = parseConfig({
    DATABASE_URL: "postgres://unused@localhost/unused",
    JWT_SECRET: TEST_JWT_SECRET,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.config;
}
