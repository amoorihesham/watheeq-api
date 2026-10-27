import { z } from "zod";
import { parseJobsSetting } from "../scheduler/select.js";

// Fields the server and the CLIs share, defined once; each schema spreads them.
const databaseFields = {
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "must be a PostgreSQL URL",
    }),
};

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ...databaseFields,
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
  // The background jobs this process runs: `all`, `none`, or comma-separated job names. Names are checked against the
  // job list at startup (`selectJobs`), which config does not know (Phase 7 spec, 4.3).
  JOBS: z
    .string()
    .default("all")
    .transform((value, ctx) => {
      const setting = parseJobsSetting(value);
      if (setting === null) {
        ctx.addIssue({ code: "custom", message: "empty job name" });
        return z.NEVER;
      }
      return setting;
    }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

// What `pnpm db:migrate` and `pnpm operator:create` need: no SMTP, storage, or JWT settings (Phase 9 spec, 4.4).
export const cliEnvSchema = z.object({
  ...databaseFields,
  // Only non-empty is checked here: the CLI applies the password-length rules itself.
  OPERATOR_PASSWORD: z.string().min(1).optional(),
});

const cliConfigSchema = cliEnvSchema.transform((env) => ({
  database: { url: env.DATABASE_URL },
  operatorPassword: env.OPERATOR_PASSWORD,
}));

const configSchema = envSchema.transform((env) => ({
  server: { env: env.NODE_ENV, port: env.PORT, logLevel: env.LOG_LEVEL },
  database: { url: env.DATABASE_URL },
  auth: {
    jwtSecret: env.JWT_SECRET,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  },
  // Both auth (password reset) and the invitation flows (tenants, users) build emailed links.
  links: {
    appBaseUrl: env.APP_BASE_URL,
    invitationTtlSeconds: env.VERIFICATION_TOKEN_TTL_SECONDS,
    passwordResetTtlSeconds: env.PASSWORD_RESET_TTL_SECONDS,
  },
  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  },
  storage: {
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  },
  jobs: { enabled: env.JOBS },
}));

/** The settings grouped by who uses them; a module is handed only its groups, never the whole object. */
export type Config = z.infer<typeof configSchema>;

export type DatabaseConfigType = Config["database"];
export type AuthConfigType = Config["auth"];
export type LinksConfigType = Config["links"];
export type EmailConfigType = Config["email"];
export type StorageConfigType = Config["storage"];

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };
export type CliConfigType = z.infer<typeof cliConfigSchema>;
export type CliConfigResult = { ok: true; config: CliConfigType } | { ok: false; message: string };

function failureMessage(error: z.ZodError, env: NodeJS.ProcessEnv): string {
  const problems = error.issues.map((issue) => {
    const key = issue.path.join(".");
    const reason = env[key] === undefined ? "Required" : issue.code;
    return `${key} (${reason})`;
  });
  return `Invalid configuration: ${problems.join(", ")}`;
}

/**
 * Validates environment variables.
 * The failure message names each offending key and a reason code, never the value,
 * because a bad value may still be a secret (for example a malformed DATABASE_URL with a password).
 */
export function parseConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const result = configSchema.safeParse(env);
  return result.success
    ? { ok: true, config: result.data }
    : { ok: false, message: failureMessage(result.error, env) };
}

/** Validates the settings the command-line tools need, with the same failure message as `parseConfig`. */
export function parseCliConfig(env: NodeJS.ProcessEnv): CliConfigResult {
  const result = cliConfigSchema.safeParse(env);
  return result.success
    ? { ok: true, config: result.data }
    : { ok: false, message: failureMessage(result.error, env) };
}
