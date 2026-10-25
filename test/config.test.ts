import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/config.js";

const valid = {
  DATABASE_URL: "postgres://u:secret@localhost:5432/db",
  JWT_SECRET: "a-jwt-secret-of-at-least-32-characters",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  EMAIL_FROM: "Watheeq <no-reply@watheeq.sa>",
  APP_BASE_URL: "http://localhost:5173",
  STORAGE_ENDPOINT: "http://localhost:8333",
  STORAGE_BUCKET: "watheeq-files",
  STORAGE_ACCESS_KEY: "access",
  STORAGE_SECRET_KEY: "secret",
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
        STORAGE_ENDPOINT: valid.STORAGE_ENDPOINT,
        STORAGE_REGION: "us-east-1",
        STORAGE_BUCKET: valid.STORAGE_BUCKET,
        STORAGE_ACCESS_KEY: valid.STORAGE_ACCESS_KEY,
        STORAGE_SECRET_KEY: valid.STORAGE_SECRET_KEY,
        STORAGE_FORCE_PATH_STYLE: false,
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

  it("reads STORAGE_FORCE_PATH_STYLE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, STORAGE_FORCE_PATH_STYLE: "true" });
    expect(on.ok && on.config.STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(parseConfig({ ...valid, STORAGE_FORCE_PATH_STYLE: "1" }).ok).toBe(false);
  });

  it("requires STORAGE_ENDPOINT to be a URL", () => {
    expect(parseConfig({ ...valid, STORAGE_ENDPOINT: "not a url" })).toEqual({
      ok: false,
      message: "Invalid configuration: STORAGE_ENDPOINT (invalid_format)",
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
        "Invalid configuration: DATABASE_URL (Required), JWT_SECRET (Required), SMTP_HOST (Required), SMTP_PORT (Required), EMAIL_FROM (Required), APP_BASE_URL (Required), STORAGE_ENDPOINT (Required), STORAGE_BUCKET (Required), STORAGE_ACCESS_KEY (Required), STORAGE_SECRET_KEY (Required)",
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
