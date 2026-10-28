import { z } from 'zod';
import { parseJobsSetting } from '../scheduler/select.js';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(60).default(10000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),
  DATABASE_TIMEOUT_MS: z.coerce.number().int().min(60).default(2000),

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
  STORAGE_UPLOAD_QUEUE_SIZE: z.coerce.number().int().min(60).default(2),

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
  JOB_REQUESTS_ESCALATIONS_INTERVAL_MS: z.coerce.number().int().min(60).default(60000),
  JOB_REQUESTS_ESCALATIONS_BUDGET_MS: z.coerce.number().int().min(60).default(50000),
  JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS: z.coerce.number().int().min(60).default(3600000),
  JOB_FILES_SWEEP_INTERVAL_MS: z.coerce.number().int().min(60).default(900000),
  JOB_FILES_SWEEP_BATCH_SIZE: z.coerce.number().int().min(60).default(100),
  JOB_FILES_SWEEP_BUDGET_MS: z.coerce.number().int().min(60).default(120000),
  JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60).default(86400000),
  JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(60).default(1000),
  JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60).default(86400000),
  JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(60).default(1000),
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

export type Config = z.infer<typeof envConfig>;
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
