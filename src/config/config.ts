import { z } from 'zod';
import { parseJobsSetting } from '../scheduler/select.js';

const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** A bounded integer setting with the value the code used before it was a setting as its default (Phase 9 spec, 4.3). */
const operational = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const intervalMs = (fallback: number) => operational(1000, MAX_INTERVAL_MS, fallback);
const budgetMs = (fallback: number) => operational(1000, MAX_INTERVAL_MS, fallback);
const batchSize = (fallback: number) => operational(1, 10_000, fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SHUTDOWN_TIMEOUT_MS: operational(1000, 300_000, 10_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_TIMEOUT_MS: operational(100, 60_000, 2000),

  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(604800),
  VERIFICATION_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(259200),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  EMAIL_FROM: z.string().min(3),

  APP_BASE_URL: z.url(),

  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  STORAGE_UPLOAD_QUEUE_SIZE: operational(1, 10, 2),

  JOBS: z
    .string()
    .default('all')
    .transform((value, ctx) => {
      const setting = parseJobsSetting(value);
      if (setting === null) {
        ctx.addIssue({ code: 'custom', message: 'empty job name' });
        return z.NEVER;
      }
      return setting;
    }),
  JOB_REQUESTS_ESCALATIONS_INTERVAL_MS: intervalMs(60_000),
  JOB_REQUESTS_ESCALATIONS_BUDGET_MS: budgetMs(50_000),
  JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS: intervalMs(3_600_000),
  JOB_FILES_SWEEP_INTERVAL_MS: intervalMs(900_000),
  JOB_FILES_SWEEP_BATCH_SIZE: batchSize(100),
  JOB_FILES_SWEEP_BUDGET_MS: budgetMs(120_000),
  JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS: intervalMs(86_400_000),
  JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE: batchSize(1000),
  JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS: intervalMs(86_400_000),
  JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE: batchSize(1000),
});

export const envConfig = envSchema.transform((args) => ({
  server: {
    env: args.NODE_ENV,
    port: args.PORT,
    logLevel: args.LOG_LEVEL,
    shutdownTimeout: args.SHUTDOWN_TIMEOUT_MS,
  },
  frontend: {
    appUrl: args.APP_BASE_URL,
  },
  database: { dbUrl: args.DATABASE_URL, dbTimeout: args.DATABASE_TIMEOUT_MS },
  auth: {
    jwt: args.JWT_SECRET,
    accessExpireTTL: args.ACCESS_TOKEN_TTL_SECONDS,
    refreshExpireTTL: args.REFRESH_TOKEN_TTL_SECONDS,
    verificationTokenTTL: args.VERIFICATION_TOKEN_TTL_SECONDS,
    resetPasswordTokenTTL: args.PASSWORD_RESET_TTL_SECONDS,
  },
  jobs: {
    escalations: { intervalMs: args.JOB_REQUESTS_ESCALATIONS_INTERVAL_MS, budgetMs: args.JOB_REQUESTS_ESCALATIONS_BUDGET_MS },
    subscriptionNotices: { intervalMs: args.JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS },
    fileSweep: { intervalMs: args.JOB_FILES_SWEEP_INTERVAL_MS, batchSize: args.JOB_FILES_SWEEP_BATCH_SIZE, budgetMs: args.JOB_FILES_SWEEP_BUDGET_MS },
    tokenCleanup: { intervalMs: args.JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS, batchSize: args.JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE },
    notificationsCleanup: { intervalMs: args.JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS, batchSize: args.JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE },
  },
  scheduler: {
    jobs: args.JOBS,
  },
  smtp: {
    smtpHost: args.SMTP_HOST,
    smtpPort: args.SMTP_PORT,
    smtpUser: args.SMTP_USER,
    smtpPassword: args.SMTP_PASSWORD,
    smtpSecure: args.SMTP_SECURE,
    emailFrom: args.EMAIL_FROM,
  },
  storage: {
    storageAccessKey: args.STORAGE_ACCESS_KEY,
    storageSecretKey: args.STORAGE_SECRET_KEY,
    storageEndpoint: args.STORAGE_ENDPOINT,
    storageRegion: args.STORAGE_REGION,
    storageBucket: args.STORAGE_BUCKET,
    storageForcePathStyle: args.STORAGE_FORCE_PATH_STYLE,
    storageUploadQueueSize: args.STORAGE_UPLOAD_QUEUE_SIZE,
  },
}));

// What `pnpm db:migrate` and `pnpm operator:create` need: no SMTP, storage, or JWT settings (Phase 9 spec, 4.4).
export const cliEnvSchema = envSchema.pick({ DATABASE_URL: true }).extend({
  // Only non-empty is checked here: the CLI applies the password-length rules itself.
  OPERATOR_PASSWORD: z.string().min(1).optional(),
});

const cliConfig = cliEnvSchema.transform((args) => ({
  database: { dbUrl: args.DATABASE_URL },
  operatorPassword: args.OPERATOR_PASSWORD,
}));

/** The settings grouped by who uses them; a module is handed only its groups, never the whole object. */
export type Config = z.infer<typeof envConfig>;
export type ServerConfigType = Config['server'];
export type FrontendConfigType = Config['frontend'];
export type DatabaseConfigType = Config['database'];
export type AuthConfigType = Config['auth'];
export type SmtpConfigType = Config['smtp'];
export type StorageConfigType = Config['storage'];
export type SchedulerConfigType = Config['scheduler'];
export type EscalationsJobConfigType = z.infer<typeof envConfig>['jobs']['escalations'];
export type SubscriptionNoticesJobConfigType = z.infer<typeof envConfig>['jobs']['subscriptionNotices'];
export type FileSweepJobConfigType = z.infer<typeof envConfig>['jobs']['fileSweep'];
export type TokenCleanupJobConfigType = z.infer<typeof envConfig>['jobs']['tokenCleanup'];
export type NotificationsCleanupJobConfigType = z.infer<typeof envConfig>['jobs']['notificationsCleanup'];

export type JobsConfigType = {
  escalations: EscalationsJobConfigType;
  subscriptionNotices: SubscriptionNoticesJobConfigType;
  fileSweep: FileSweepJobConfigType;
  tokenCleanup: TokenCleanupJobConfigType;
  notificationsCleanup: NotificationsCleanupJobConfigType;
};

type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };
export type CliConfigType = z.infer<typeof cliConfig>;
type CliConfigResult = { ok: true; config: CliConfigType } | { ok: false; message: string };

function failureMessage(error: z.ZodError, env: NodeJS.ProcessEnv): string {
  const problems = error.issues.map((issue) => {
    const key = issue.path.join('.');
    const reason = issue.code === 'invalid_type' && env[key] === undefined ? 'Required' : issue.code;
    return `${key} (${reason})`;
  });
  return `Invalid configuration: ${problems.join(', ')}`;
}

export function parseConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const result = envConfig.safeParse(env);
  return result.success ? { ok: true, config: result.data } : { ok: false, message: failureMessage(result.error, env) };
}

/** Validates the settings the command-line tools need, with the same failure message as `parseConfig`. */
export function parseCliConfig(env: NodeJS.ProcessEnv): CliConfigResult {
  const result = cliConfig.safeParse(env);
  return result.success ? { ok: true, config: result.data } : { ok: false, message: failureMessage(result.error, env) };
}
