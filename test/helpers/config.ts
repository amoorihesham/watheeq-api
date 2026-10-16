import { type Config, parseConfig } from "../../src/config/config.js";

/** Validated configuration with all defaults, for tests. Overrides are raw environment strings. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  const result = parseConfig({
    DATABASE_URL: "postgres://unused@localhost/unused",
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.config;
}
