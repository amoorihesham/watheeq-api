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
        OPERATOR_SESSION_ABSOLUTE_SECONDS: 28800,
        OPERATOR_SESSION_IDLE_SECONDS: 1800,
        TENANT_SESSION_ABSOLUTE_SECONDS: 43200,
        TENANT_SESSION_IDLE_SECONDS: 7200,
        LOGIN_ACCOUNT_MAX_FAILURES: 5,
        LOGIN_ACCOUNT_LOCK_SECONDS: 900,
        LOGIN_IP_MAX_FAILURES: 100,
        LOGIN_IP_WINDOW_SECONDS: 900,
        TRUST_PROXY: 0,
        PORT: 3000,
        DATABASE_URL: valid.DATABASE_URL,
        LOG_LEVEL: "info",
      },
    });
  });

  it("reads operator session lifetimes and rejects nonsense", () => {
    const ok = parseConfig({ ...valid, OPERATOR_SESSION_IDLE_SECONDS: "600" });
    expect(ok.ok && ok.config.OPERATOR_SESSION_IDLE_SECONDS).toBe(600);
    expect(parseConfig({ ...valid, OPERATOR_SESSION_ABSOLUTE_SECONDS: "0" })).toEqual({
      ok: false,
      message: "Invalid configuration: OPERATOR_SESSION_ABSOLUTE_SECONDS (too_small)",
    });
  });

  it("reads tenant session lifetimes, throttling thresholds, and TRUST_PROXY", () => {
    const ok = parseConfig({
      ...valid,
      TENANT_SESSION_IDLE_SECONDS: "600",
      LOGIN_ACCOUNT_MAX_FAILURES: "3",
      TRUST_PROXY: "2",
    });
    expect(ok.ok && ok.config.TENANT_SESSION_IDLE_SECONDS).toBe(600);
    expect(ok.ok && ok.config.LOGIN_ACCOUNT_MAX_FAILURES).toBe(3);
    expect(ok.ok && ok.config.TRUST_PROXY).toBe(2);
    expect(parseConfig({ ...valid, TRUST_PROXY: "-1" })).toEqual({
      ok: false,
      message: "Invalid configuration: TRUST_PROXY (too_small)",
    });
    expect(parseConfig({ ...valid, TENANT_SESSION_ABSOLUTE_SECONDS: "59" })).toEqual({
      ok: false,
      message: "Invalid configuration: TENANT_SESSION_ABSOLUTE_SECONDS (too_small)",
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
