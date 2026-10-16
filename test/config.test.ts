import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/config.js";

const valid = { DATABASE_URL: "postgres://u:secret@localhost:5432/db" };

describe("parseConfig", () => {
  it("applies defaults", () => {
    const result = parseConfig(valid);
    expect(result).toEqual({
      ok: true,
      config: {
        NODE_ENV: "development",
        PORT: 3000,
        DATABASE_URL: valid.DATABASE_URL,
        LOG_LEVEL: "info",
      },
    });
  });

  it("coerces PORT to a number", () => {
    const result = parseConfig({ ...valid, PORT: "8080" });
    expect(result.ok && result.config.PORT).toBe(8080);
  });

  it("names a missing key", () => {
    expect(parseConfig({})).toEqual({
      ok: false,
      message: "Invalid configuration: DATABASE_URL (Required)",
    });
  });

  it("names every invalid key and never prints values", () => {
    const result = parseConfig({
      DATABASE_URL: "mysql://u:hunter2@host/db",
      PORT: "not-a-port",
      LOG_LEVEL: "loud",
      NODE_ENV: "staging",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const key of ["DATABASE_URL", "PORT", "LOG_LEVEL", "NODE_ENV"]) {
      expect(result.message).toContain(key);
    }
    for (const value of ["hunter2", "not-a-port", "loud", "staging"]) {
      expect(result.message).not.toContain(value);
    }
  });

  it("rejects an out-of-range PORT", () => {
    expect(parseConfig({ ...valid, PORT: "70000" }).ok).toBe(false);
  });
});
