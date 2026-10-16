import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), { message: "must be a PostgreSQL URL" }),
  // Operator session lifetimes in seconds (spec 4.3): 30 minutes idle, 8 hours absolute.
  OPERATOR_SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).default(1800),
  OPERATOR_SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).default(28800),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };

/**
 * Validates environment variables.
 * The failure message names each offending key and a reason code, never the value,
 * because a bad value may still be a secret (for example a malformed DATABASE_URL with a password).
 */
export function parseConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const result = configSchema.safeParse(env);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join(".");
    const reason = env[key] === undefined ? "Required" : issue.code;
    return `${key} (${reason})`;
  });
  return { ok: false, message: `Invalid configuration: ${problems.join(", ")}` };
}
