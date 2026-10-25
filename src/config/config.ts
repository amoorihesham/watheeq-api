import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "must be a PostgreSQL URL",
    }),
  // HS256 signing key for access tokens (Phase 0 spec, P0.12). 32 characters is the floor for a 256-bit HMAC key.
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(604800),
  // SMTP for verification emails: Mailpit locally, the chosen KSA provider in production (Phase 1 spec, P1.18).
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  // z.coerce.boolean would read "false" as true, so the two spellings are listed explicitly.
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EMAIL_FROM: z.string().min(3),
  APP_BASE_URL: z.url(),
  VERIFICATION_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(259200),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  // S3-compatible object storage for uploaded files: a local server in Docker for development and tests, a private
  // bucket at the chosen KSA provider in production (Phase 5.5 spec, P5.5.5).
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default("us-east-1"),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  // Path-style URLs (http://host/bucket/key) for local servers; virtual-hosted style for most providers.
  STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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
  return {
    ok: false,
    message: `Invalid configuration: ${problems.join(", ")}`,
  };
}
