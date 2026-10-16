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
});
