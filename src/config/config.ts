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
  // Tenant session lifetimes in seconds (spec 4.3): 2 hours idle, 12 hours absolute.
  TENANT_SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).default(7200),
  TENANT_SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).default(43200),
  // Login throttling (spec 4.3): 5 failures lock an account for 15 minutes; 100 failures per 15-minute window block an IP.
  LOGIN_ACCOUNT_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_ACCOUNT_LOCK_SECONDS: z.coerce.number().int().min(1).default(900),
  LOGIN_IP_MAX_FAILURES: z.coerce.number().int().min(1).default(100),
  LOGIN_IP_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),
  // Number of reverse proxies in front of the app (spec 4.3, "Deployment topology and client IP").
  // 0 ignores X-Forwarded-For entirely; N trusts only the N proxy hops nearest to the app.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
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
