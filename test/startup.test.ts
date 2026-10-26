import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

function runMain(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // Minimal environment: nothing from the developer's shell or .env leaks into the child.
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("startup", () => {
  it("exits with code 1 and names the missing key when DATABASE_URL is unset", async () => {
    const { code, output } = await runMain({});
    expect(code).toBe(1);
    expect(output).toContain("Invalid configuration: DATABASE_URL (Required)");
  });

  it("names invalid keys without printing their values", async () => {
    const { code, output } = await runMain({
      DATABASE_URL: "postgres://u:topsecret@localhost:5432/db",
      PORT: "abc",
    });
    expect(code).toBe(1);
    expect(output).toContain("PORT");
    expect(output).not.toContain("topsecret");
    expect(output).not.toContain("abc");
  });

  it("refuses to start when JOBS names an unknown job, naming it", async () => {
    const { code, output } = await runMain({
      DATABASE_URL: "postgres://u:p@localhost:1/db",
      JWT_SECRET: "a-jwt-secret-of-at-least-32-characters",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      EMAIL_FROM: "Watheeq <no-reply@watheeq.sa>",
      APP_BASE_URL: "http://localhost:5173",
      STORAGE_ENDPOINT: "http://localhost:8333",
      STORAGE_BUCKET: "watheeq-files",
      STORAGE_ACCESS_KEY: "access",
      STORAGE_SECRET_KEY: "secret",
      JOBS: "files.sweep,files.swep",
    });
    expect(code).toBe(1);
    expect(output).toContain("files.swep");
    expect(output).toContain("invalid JOBS setting");
  });
});
