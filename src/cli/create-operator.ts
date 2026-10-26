import pg from "pg";
import { createDb } from "../db/pool.js";
import { AppError, fromDatabaseError } from "../http/errors.js";
import {
  MAX_PASSWORD_LENGTH,
  MAX_USER_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../modules/auth/auth.config.js";
import { createOperator } from "../modules/auth/auth.service.js";

// Reads the URL directly: validated config is for the running app, not this tool.
const url = process.env.DATABASE_URL;
const email = process.argv[2];
const userName = process.argv[3];

if (!url || !email || !userName || process.argv.length > 4) {
  console.error('Usage: pnpm operator:create <email> "<full name>"');
  console.error(
    "Reads the password from OPERATOR_PASSWORD, or prompts for it. Never pass it as an argument.",
  );
  console.error("Requires DATABASE_URL.");
  process.exit(1);
}

/** A failure whose message is safe and useful to print as is. */
class CliError extends Error {}

/** Reads a line from the terminal without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          return;
        }
        if (char === "\u0003") {
          finish(new CliError("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.OPERATOR_PASSWORD;
  if (fromEnv) {
    return fromEnv;
  }
  if (!process.stdin.isTTY) {
    throw new CliError("Set OPERATOR_PASSWORD, or run this in an interactive terminal.");
  }
  const first = await promptHidden("Password: ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) {
    throw new CliError("The passwords do not match.");
  }
  return first;
}

/** Opens a single connection for this one insert and always closes it. */
async function createWithConnection(databaseUrl: string, rawEmail: string, rawUserName: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    return await createOperator(createDb(pool), {
      email: rawEmail,
      userName: rawUserName,
      password: await readPassword(),
    });
  } finally {
    await pool.end();
  }
}

/** The message for an AppError from the service, or undefined for an unexpected error. */
function messageFor(err: AppError): string | undefined {
  switch (err.code) {
    case "VALIDATION_FAILED": {
      const labels: Record<string, string> = {
        email: "email",
        userName: "name",
        password: "password",
      };
      const fields = [...new Set((err.details ?? []).map((detail) => detail.path))];
      return `Invalid ${fields.map((field) => labels[field] ?? field).join(" and ")}. The name must be 1-${MAX_USER_NAME_LENGTH} characters and the password ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH}.`;
    }
    case "TAKEN":
      return `An account with email ${email?.trim().toLowerCase()} already exists.`;
    default:
      return undefined;
  }
}

try {
  const operator = await createWithConnection(url, email, userName);
  console.log(`operator created: ${operator.userName} <${operator.email}> (${operator.id})`);
} catch (err) {
  const appError = err instanceof AppError ? err : fromDatabaseError(err);
  const message = appError && messageFor(appError);
  if (err instanceof CliError) {
    console.error(err.message);
  } else if (message) {
    console.error(message);
  } else {
    // Not err.message: a failed query's message includes its parameters, which contain the password hash.
    const cause = (err as { cause?: { message?: string } }).cause;
    console.error("Could not create the operator:", cause?.message ?? "unexpected error");
  }
  process.exit(1);
}
