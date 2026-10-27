import { z } from "zod";
import { parseJobsSetting } from "../scheduler/select.js";

const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** An operational integer setting: coerced like the other numbers, bounded, and defaulted to today's value. */
const operational = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const intervalMs = (fallback: number) => operational(1000, MAX_INTERVAL_MS, fallback);
const batchSize = (fallback: number) => operational(1, 10_000, fallback);

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

  // Operational settings (Phase 9 spec, 4.3). The defaults are the values the code used before they were settings.
  // How long a graceful shutdown waits for in-flight requests before closing their connections.
  SHUTDOWN_TIMEOUT_MS: operational(1000, 300_000, 10_000),
  // The pool's connection timeout, and also the deadline of the /health database check.
  DATABASE_TIMEOUT_MS: operational(100, 60_000, 2000),
  // Parts of one upload sent to the store at the same time.
  STORAGE_UPLOAD_QUEUE_SIZE: operational(1, 10, 2),
  // A job's interval is the pause between the end of one run and the start of the next. A budget is the time after
  // which a run stops starting new work and leaves the rest to the next run; it must stay below its interval (see the
  // refinement below), so lowering an interval may need a lower budget too.
  JOB_REQUESTS_ESCALATIONS_INTERVAL_MS: intervalMs(60_000),
  JOB_REQUESTS_ESCALATIONS_BUDGET_MS: operational(1000, MAX_INTERVAL_MS, 50_000),
  JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS: intervalMs(3_600_000),
  JOB_FILES_SWEEP_INTERVAL_MS: intervalMs(900_000),
  JOB_FILES_SWEEP_BATCH_SIZE: batchSize(100),
  JOB_FILES_SWEEP_BUDGET_MS: operational(1000, MAX_INTERVAL_MS, 120_000),
  JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS: intervalMs(86_400_000),
  JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE: batchSize(1000),
  JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS: intervalMs(86_400_000),
  JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE: batchSize(1000),
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

/** Pairs of a budget key and its interval key (Phase 9 spec, R9.5). */
const BUDGETS = [
  ["JOB_REQUESTS_ESCALATIONS_BUDGET_MS", "JOB_REQUESTS_ESCALATIONS_INTERVAL_MS"],
  ["JOB_FILES_SWEEP_BUDGET_MS", "JOB_FILES_SWEEP_INTERVAL_MS"],
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.keys(envSchema.shape));

/** Environment keys that start with `JOB_` but are no setting, such as a typo: they would be ignored silently. */
export function unknownJobKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) => key.startsWith("JOB_") && !KNOWN_KEYS.has(key));
}

const configSchema = envSchema
  .superRefine(
    (env, ctx) => {
      for (const [budgetKey, intervalKey] of BUDGETS) {
        if (env[budgetKey] >= env[intervalKey]) {
          ctx.addIssue({
            code: "custom",
            path: [budgetKey],
            message: "must be below its interval",
          });
        }
      }
    },
    // Only when every value is valid on its own, so a bad interval is reported once, not again as a budget problem.
    { when: (payload) => payload.issues === undefined || payload.issues.length === 0 },
  )
  .transform((env) => ({
    server: {
      env: env.NODE_ENV,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
    database: { url: env.DATABASE_URL, timeoutMs: env.DATABASE_TIMEOUT_MS },
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
      uploadQueueSize: env.STORAGE_UPLOAD_QUEUE_SIZE,
    },
    jobs: {
      enabled: env.JOBS,
      escalations: {
        intervalMs: env.JOB_REQUESTS_ESCALATIONS_INTERVAL_MS,
        budgetMs: env.JOB_REQUESTS_ESCALATIONS_BUDGET_MS,
      },
      subscriptionNotices: { intervalMs: env.JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS },
      fileSweep: {
        intervalMs: env.JOB_FILES_SWEEP_INTERVAL_MS,
        batchSize: env.JOB_FILES_SWEEP_BATCH_SIZE,
        budgetMs: env.JOB_FILES_SWEEP_BUDGET_MS,
      },
      tokenCleanup: {
        intervalMs: env.JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS,
        batchSize: env.JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE,
      },
      notificationsCleanup: {
        intervalMs: env.JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS,
        batchSize: env.JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE,
      },
    },
  }));

/** The settings grouped by who uses them; a module is handed only its groups, never the whole object. */
export type Config = z.infer<typeof configSchema>;

export type DatabaseConfigType = Config["database"];
export type AuthConfigType = Config["auth"];
export type LinksConfigType = Config["links"];
export type EmailConfigType = Config["email"];
export type StorageConfigType = Config["storage"];
export type JobsConfigType = Config["jobs"];
export type EscalationsJobConfigType = JobsConfigType["escalations"];
export type SubscriptionNoticesJobConfigType = JobsConfigType["subscriptionNotices"];
export type FileSweepJobConfigType = JobsConfigType["fileSweep"];
export type TokenCleanupJobConfigType = JobsConfigType["tokenCleanup"];
export type NotificationsCleanupJobConfigType = JobsConfigType["notificationsCleanup"];

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };
export type CliConfigType = z.infer<typeof cliConfigSchema>;
export type CliConfigResult = { ok: true; config: CliConfigType } | { ok: false; message: string };

function failureMessage(error: z.ZodError, env: NodeJS.ProcessEnv): string {
  const problems = error.issues.map((issue) => {
    const key = issue.path.join(".");
    const reason =
      issue.code === "invalid_type" && env[key] === undefined ? "Required" : issue.code;
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
