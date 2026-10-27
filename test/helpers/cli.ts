import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inject } from "vitest";

const run = promisify(execFile);

interface CliResultType {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  script: string,
  args: string[],
  env: Record<string, string>,
): Promise<CliResultType> {
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", script, ...args], {
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: inject("databaseUrl"), ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

/** Runs `pnpm operator:create` the way a deployer does, against the test database. */
export function runCreateOperator(args: string[], env: Record<string, string>) {
  return runCli("src/cli/create-operator.ts", args, env);
}

/** Runs `pnpm db:migrate` with only the given environment on top of the test DATABASE_URL. */
export function runMigrate(env: Record<string, string> = {}) {
  return runCli("src/cli/migrate.ts", [], env);
}
