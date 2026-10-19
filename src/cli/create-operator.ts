import {
  CreateOperatorError,
  createOperator,
} from "../modules/auth/operator/operator-auth.service.js";

// Reads the URL directly: validated config is for the running app, not this tool.
// Connects as watheeq_owner, because the application role cannot insert operators.
const url = process.env.MIGRATION_DATABASE_URL;
const email = process.argv[2];

if (!url || !email || process.argv.length > 3) {
  console.error("Usage: pnpm operator:create <email>");
  console.error(
    "Reads the password from OPERATOR_PASSWORD, or prompts for it. Never pass it as an argument.",
  );
  console.error("Requires MIGRATION_DATABASE_URL (watheeq_owner).");
  process.exit(1);
}

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
          finish(new CreateOperatorError("Cancelled."));
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
    throw new CreateOperatorError("Set OPERATOR_PASSWORD, or run this in an interactive terminal.");
  }
  const first = await promptHidden("Password: ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) {
    throw new CreateOperatorError("The passwords do not match.");
  }
  return first;
}

try {
  const operator = await createOperator(url, email, await readPassword());
  console.log(`operator created: ${operator.email} (${operator.id})`);
} catch (err) {
  if (err instanceof CreateOperatorError) {
    console.error(err.message);
  } else {
    // Not err.message: a failed query's message includes its parameters, which contain the password hash.
    const cause = (err as { cause?: { message?: string } }).cause;
    console.error("Could not create the operator:", cause?.message ?? "unexpected error");
  }
  process.exit(1);
}
