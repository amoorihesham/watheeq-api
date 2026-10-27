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
        server: { env: "development", port: 3000, logLevel: "info" },
        database: { url: valid.DATABASE_URL },
        auth: {
          jwtSecret: valid.JWT_SECRET,
          accessTokenTtlSeconds: 1800,
          refreshTokenTtlSeconds: 604800,
        },
        links: {
          appBaseUrl: valid.APP_BASE_URL,
          invitationTtlSeconds: 259200,
          passwordResetTtlSeconds: 3600,
        },
        email: {
          host: "localhost",
          port: 1025,
          secure: false,
          user: undefined,
          password: undefined,
          from: valid.EMAIL_FROM,
        },
        storage: {
          endpoint: valid.STORAGE_ENDPOINT,
          region: "us-east-1",
          bucket: valid.STORAGE_BUCKET,
          accessKey: valid.STORAGE_ACCESS_KEY,
          secretKey: valid.STORAGE_SECRET_KEY,
          forcePathStyle: false,
        },
        jobs: { enabled: "all" },
      },
    });
  });

  it("maps every variable to its group when all are set", () => {
    const result = parseConfig({
      ...valid,
      NODE_ENV: "production",
      PORT: "8080",
      LOG_LEVEL: "warn",
      ACCESS_TOKEN_TTL_SECONDS: "900",
      REFRESH_TOKEN_TTL_SECONDS: "3600",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "mail-pass",
      VERIFICATION_TOKEN_TTL_SECONDS: "7200",
      PASSWORD_RESET_TTL_SECONDS: "600",
      STORAGE_REGION: "me-south-1",
      STORAGE_FORCE_PATH_STYLE: "true",
      JOBS: "files.sweep",
    });
    expect(result.ok && result.config).toMatchObject({
      server: { env: "production", port: 8080, logLevel: "warn" },
      auth: { accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600 },
      links: { invitationTtlSeconds: 7200, passwordResetTtlSeconds: 600 },
      email: { secure: true, user: "mailer", password: "mail-pass" },
      storage: { region: "me-south-1", forcePathStyle: true },
      jobs: { enabled: ["files.sweep"] },
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
    expect(ok.ok && ok.config.auth.accessTokenTtlSeconds).toBe(900);
    expect(parseConfig({ ...valid, REFRESH_TOKEN_TTL_SECONDS: "59" })).toEqual({
      ok: false,
      message: "Invalid configuration: REFRESH_TOKEN_TTL_SECONDS (too_small)",
    });
  });

  it("reads SMTP_SECURE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, SMTP_SECURE: "true" });
    expect(on.ok && on.config.email.secure).toBe(true);
    const off = parseConfig({ ...valid, SMTP_SECURE: "false" });
    expect(off.ok && off.config.email.secure).toBe(false);
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
    expect(on.ok && on.config.storage.forcePathStyle).toBe(true);
    expect(parseConfig({ ...valid, STORAGE_FORCE_PATH_STYLE: "1" }).ok).toBe(false);
  });

  it("requires STORAGE_ENDPOINT to be a URL", () => {
    expect(parseConfig({ ...valid, STORAGE_ENDPOINT: "not a url" })).toEqual({
      ok: false,
      message: "Invalid configuration: STORAGE_ENDPOINT (invalid_format)",
    });
  });

  it("reads JOBS as all, none, or a list of job names", () => {
    const read = (JOBS: string) => {
      const result = parseConfig({ ...valid, JOBS });
      return result.ok ? result.config.jobs.enabled : result.message;
    };
    expect(read("none")).toBe("none");
    expect(read("files.sweep")).toEqual(["files.sweep"]);
    expect(read(" files.sweep , auth.token_cleanup ")).toEqual([
      "files.sweep",
      "auth.token_cleanup",
    ]);
  });

  it("rejects an empty job name in JOBS", () => {
    for (const JOBS of ["", "files.sweep,", ",", " "]) {
      expect(parseConfig({ ...valid, JOBS })).toEqual({
        ok: false,
        message: "Invalid configuration: JOBS (custom)",
      });
    }
  });

  it("coerces PORT to a number", () => {
    const result = parseConfig({ ...valid, PORT: "8080" });
    expect(result.ok && result.config.server.port).toBe(8080);
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
