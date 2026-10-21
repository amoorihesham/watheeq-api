import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inject } from "vitest";

const run = promisify(execFile);

/** Runs `pnpm operator:create` the way a deployer does, against the test database. */
export async function runCreateOperator(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", "src/cli/create-operator.ts", ...args],
      { env: { PATH: process.env.PATH ?? "", DATABASE_URL: inject("databaseUrl"), ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
