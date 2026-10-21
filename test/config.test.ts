import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/config.js";

const valid = {
  DATABASE_URL: "postgres://u:secret@localhost:5432/db",
  JWT_SECRET: "a-jwt-secret-of-at-least-32-characters",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  EMAIL_FROM: "Watheeq <no-reply@watheeq.sa>",
  APP_BASE_URL: "http://localhost:5173",
};

describe("parseConfig", () => {
  it("applies defaults", () => {
    const result = parseConfig(valid);
    expect(result).toEqual({
      ok: true,
      config: {
        NODE_ENV: "development",
        PORT: 3000,
        DATABASE_URL: valid.DATABASE_URL,
        JWT_SECRET: valid.JWT_SECRET,
        ACCESS_TOKEN_TTL_SECONDS: 1800,
        REFRESH_TOKEN_TTL_SECONDS: 604800,
        SMTP_HOST: "localhost",
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        EMAIL_FROM: valid.EMAIL_FROM,
        APP_BASE_URL: valid.APP_BASE_URL,
        VERIFICATION_TOKEN_TTL_SECONDS: 259200,
        PASSWORD_RESET_TTL_SECONDS: 3600,
        LOG_LEVEL: "info",
      },
    });
  });

  it("rejects a JWT_SECRET shorter than 32 characters without printing it", () => {
    expect(parseConfig({ ...valid, JWT_SECRET: "short-secret" })).toEqual({
      ok: false,
      message: "Invalid configuration: JWT_SECRET (too_small)",
    });
  });

  it("reads token lifetimes and rejects ones under a minute", () => {
    const ok = parseConfig({ ...valid, ACCESS_TOKEN_TTL_SECONDS: "900" });
    expect(ok.ok && ok.config.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(parseConfig({ ...valid, REFRESH_TOKEN_TTL_SECONDS: "59" })).toEqual({
      ok: false,
      message: "Invalid configuration: REFRESH_TOKEN_TTL_SECONDS (too_small)",
    });
  });

  it("reads SMTP_SECURE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, SMTP_SECURE: "true" });
    expect(on.ok && on.config.SMTP_SECURE).toBe(true);
    const off = parseConfig({ ...valid, SMTP_SECURE: "false" });
    expect(off.ok && off.config.SMTP_SECURE).toBe(false);
    expect(parseConfig({ ...valid, SMTP_SECURE: "yes" }).ok).toBe(false);
  });

  it("requires APP_BASE_URL to be a URL", () => {
    expect(parseConfig({ ...valid, APP_BASE_URL: "not a url" })).toEqual({
      ok: false,
      message: "Invalid configuration: APP_BASE_URL (invalid_format)",
    });
  });

  it("coerces PORT to a number", () => {
    const result = parseConfig({ ...valid, PORT: "8080" });
    expect(result.ok && result.config.PORT).toBe(8080);
  });

  it("names a missing key", () => {
    expect(parseConfig({})).toEqual({
      ok: false,
      message:
        "Invalid configuration: DATABASE_URL (Required), JWT_SECRET (Required), SMTP_HOST (Required), SMTP_PORT (Required), EMAIL_FROM (Required), APP_BASE_URL (Required)",
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
