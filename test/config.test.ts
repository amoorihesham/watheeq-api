import { describe, expect, it } from 'vitest';
import { type Config, parseCliConfig, parseConfig } from '../src/config/config.js';

const valid = {
  DATABASE_URL: 'postgres://u:secret@localhost:5432/db',
  JWT_SECRET: 'a-jwt-secret-of-at-least-32-characters',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  EMAIL_FROM: 'Watheeq <no-reply@watheeq.sa>',
  APP_BASE_URL: 'http://localhost:5173',
  STORAGE_ENDPOINT: 'http://localhost:8333',
  STORAGE_BUCKET: 'watheeq-files',
  STORAGE_ACCESS_KEY: 'access',
  STORAGE_SECRET_KEY: 'secret',
};

describe('parseConfig', () => {
  it('applies defaults', () => {
    const result = parseConfig(valid);
    expect(result).toEqual({
      ok: true,
      config: {
        server: { env: 'development', port: 3000, logLevel: 'info', shutdownTimeout: 10_000 },
        frontend: { appUrl: valid.APP_BASE_URL },
        database: { dbUrl: valid.DATABASE_URL, dbTimeout: 2000 },
        auth: {
          jwt: valid.JWT_SECRET,
          accessExpireTTL: 1800,
          refreshExpireTTL: 604800,
          verificationTokenTTL: 259200,
          resetPasswordTokenTTL: 3600,
        },
        smtp: {
          smtpHost: 'localhost',
          smtpPort: 1025,
          smtpSecure: false,
          smtpUser: undefined,
          smtpPassword: undefined,
          emailFrom: valid.EMAIL_FROM,
        },
        storage: {
          storageEndpoint: valid.STORAGE_ENDPOINT,
          storageRegion: 'us-east-1',
          storageBucket: valid.STORAGE_BUCKET,
          storageAccessKey: valid.STORAGE_ACCESS_KEY,
          storageSecretKey: valid.STORAGE_SECRET_KEY,
          storageForcePathStyle: false,
          storageUploadQueueSize: 2,
        },
        scheduler: { jobs: 'all' },
        jobs: {
          escalations: { intervalMs: 60_000, budgetMs: 50_000 },
          subscriptionNotices: { intervalMs: 3_600_000 },
          fileSweep: { intervalMs: 900_000, batchSize: 100, budgetMs: 120_000 },
          tokenCleanup: { intervalMs: 86_400_000, batchSize: 1000 },
          notificationsCleanup: { intervalMs: 86_400_000, batchSize: 1000 },
        },
      },
    });
  });

  it('maps every variable to its group when all are set', () => {
    const result = parseConfig({
      ...valid,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      ACCESS_TOKEN_TTL_SECONDS: '900',
      REFRESH_TOKEN_TTL_SECONDS: '3600',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'mail-pass',
      VERIFICATION_TOKEN_TTL_SECONDS: '7200',
      PASSWORD_RESET_TTL_SECONDS: '600',
      STORAGE_REGION: 'me-south-1',
      STORAGE_FORCE_PATH_STYLE: 'true',
      JOBS: 'files.sweep',
    });
    expect(result.ok && result.config).toMatchObject({
      server: { env: 'production', port: 8080, logLevel: 'warn' },
      auth: { accessExpireTTL: 900, refreshExpireTTL: 3600, verificationTokenTTL: 7200, resetPasswordTokenTTL: 600 },
      smtp: { smtpSecure: true, smtpUser: 'mailer', smtpPassword: 'mail-pass' },
      storage: { storageRegion: 'me-south-1', storageForcePathStyle: true },
      scheduler: { jobs: ['files.sweep'] },
    });
  });

  it('rejects a JWT_SECRET shorter than 32 characters without printing it', () => {
    expect(parseConfig({ ...valid, JWT_SECRET: 'short-secret' })).toEqual({
      ok: false,
      message: 'Invalid configuration: JWT_SECRET (too_small)',
    });
  });

  it('reads token lifetimes and rejects ones under a minute', () => {
    const ok = parseConfig({ ...valid, ACCESS_TOKEN_TTL_SECONDS: '900' });
    expect(ok.ok && ok.config.auth.accessExpireTTL).toBe(900);
    expect(parseConfig({ ...valid, REFRESH_TOKEN_TTL_SECONDS: '59' })).toEqual({
      ok: false,
      message: 'Invalid configuration: REFRESH_TOKEN_TTL_SECONDS (too_small)',
    });
  });

  it("reads SMTP_SECURE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, SMTP_SECURE: 'true' });
    expect(on.ok && on.config.smtp.smtpSecure).toBe(true);
    const off = parseConfig({ ...valid, SMTP_SECURE: 'false' });
    expect(off.ok && off.config.smtp.smtpSecure).toBe(false);
    expect(parseConfig({ ...valid, SMTP_SECURE: 'yes' }).ok).toBe(false);
  });

  it('requires APP_BASE_URL to be a URL', () => {
    expect(parseConfig({ ...valid, APP_BASE_URL: 'not a url' })).toEqual({
      ok: false,
      message: 'Invalid configuration: APP_BASE_URL (invalid_format)',
    });
  });

  it("reads STORAGE_FORCE_PATH_STYLE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, STORAGE_FORCE_PATH_STYLE: 'true' });
    expect(on.ok && on.config.storage.storageForcePathStyle).toBe(true);
    expect(parseConfig({ ...valid, STORAGE_FORCE_PATH_STYLE: '1' }).ok).toBe(false);
  });

  it('requires STORAGE_ENDPOINT to be a URL', () => {
    expect(parseConfig({ ...valid, STORAGE_ENDPOINT: 'not a url' })).toEqual({
      ok: false,
      message: 'Invalid configuration: STORAGE_ENDPOINT (invalid_format)',
    });
  });

  it('reads JOBS as all, none, or a list of job names', () => {
    const read = (JOBS: string) => {
      const result = parseConfig({ ...valid, JOBS });
      return result.ok ? result.config.scheduler.jobs : result.message;
    };
    expect(read('none')).toBe('none');
    expect(read('files.sweep')).toEqual(['files.sweep']);
    expect(read(' files.sweep , auth.token_cleanup ')).toEqual(['files.sweep', 'auth.token_cleanup']);
  });

  it('rejects an empty job name in JOBS', () => {
    for (const JOBS of ['', 'files.sweep,', ',', ' ']) {
      expect(parseConfig({ ...valid, JOBS })).toEqual({
        ok: false,
        message: 'Invalid configuration: JOBS (custom)',
      });
    }
  });

  it('coerces PORT to a number', () => {
    const result = parseConfig({ ...valid, PORT: '8080' });
    expect(result.ok && result.config.server.port).toBe(8080);
  });

  it('names a missing key', () => {
    expect(parseConfig({})).toEqual({
      ok: false,
      message:
        'Invalid configuration: DATABASE_URL (Required), JWT_SECRET (Required), SMTP_HOST (Required), SMTP_PORT (Required), EMAIL_FROM (Required), APP_BASE_URL (Required), STORAGE_ACCESS_KEY (Required), STORAGE_SECRET_KEY (Required), STORAGE_ENDPOINT (Required), STORAGE_BUCKET (Required)',
    });
  });

  it('names every invalid key and never prints values', () => {
    const result = parseConfig({
      DATABASE_URL: 'mysql://u:hunter2@host/db',
      PORT: 'not-a-port',
      LOG_LEVEL: 'loud',
      NODE_ENV: 'staging',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const key of ['DATABASE_URL', 'PORT', 'LOG_LEVEL', 'NODE_ENV']) {
      expect(result.message).toContain(key);
    }
    for (const value of ['hunter2', 'not-a-port', 'loud', 'staging']) {
      expect(result.message).not.toContain(value);
    }
  });

  it('rejects an out-of-range PORT', () => {
    expect(parseConfig({ ...valid, PORT: '70000' }).ok).toBe(false);
  });
});

describe('parseCliConfig', () => {
  it('needs only DATABASE_URL', () => {
    expect(parseCliConfig({ DATABASE_URL: valid.DATABASE_URL })).toEqual({
      ok: true,
      config: { database: { dbUrl: valid.DATABASE_URL }, operatorPassword: undefined },
    });
  });

  it('reads OPERATOR_PASSWORD when set and rejects an empty one', () => {
    const set = parseCliConfig({ DATABASE_URL: valid.DATABASE_URL, OPERATOR_PASSWORD: 'pw' });
    expect(set.ok && set.config.operatorPassword).toBe('pw');
    expect(parseCliConfig({ DATABASE_URL: valid.DATABASE_URL, OPERATOR_PASSWORD: '' }).ok).toBe(false);
  });

  it('names a non-PostgreSQL DATABASE_URL without printing it', () => {
    const result = parseCliConfig({ DATABASE_URL: 'mysql://u:topsecret@host/db' });
    expect(result).toEqual({ ok: false, message: 'Invalid configuration: DATABASE_URL (invalid_format)' });
  });

  it('reports a missing DATABASE_URL as Required', () => {
    expect(parseCliConfig({})).toEqual({
      ok: false,
      message: 'Invalid configuration: DATABASE_URL (Required)',
    });
  });
});

// Phase 9 spec, 4.3: key, default, and bounds of each operational setting.
const OPERATIONAL = [
  ['SHUTDOWN_TIMEOUT_MS', 10_000, 1000, 300_000, (c: Config) => c.server.shutdownTimeout],
  ['DATABASE_TIMEOUT_MS', 2000, 100, 60_000, (c: Config) => c.database.dbTimeout],
  ['STORAGE_UPLOAD_QUEUE_SIZE', 2, 1, 10, (c: Config) => c.storage.storageUploadQueueSize],
  ['JOB_REQUESTS_ESCALATIONS_INTERVAL_MS', 60_000, 1000, 604_800_000, (c: Config) => c.jobs.escalations.intervalMs],
  ['JOB_REQUESTS_ESCALATIONS_BUDGET_MS', 50_000, 1000, 604_800_000, (c: Config) => c.jobs.escalations.budgetMs],
  ['JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS', 3_600_000, 1000, 604_800_000, (c: Config) => c.jobs.subscriptionNotices.intervalMs],
  ['JOB_FILES_SWEEP_INTERVAL_MS', 900_000, 1000, 604_800_000, (c: Config) => c.jobs.fileSweep.intervalMs],
  ['JOB_FILES_SWEEP_BATCH_SIZE', 100, 1, 10_000, (c: Config) => c.jobs.fileSweep.batchSize],
  ['JOB_FILES_SWEEP_BUDGET_MS', 120_000, 1000, 604_800_000, (c: Config) => c.jobs.fileSweep.budgetMs],
  ['JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS', 86_400_000, 1000, 604_800_000, (c: Config) => c.jobs.tokenCleanup.intervalMs],
  ['JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE', 1000, 1, 10_000, (c: Config) => c.jobs.tokenCleanup.batchSize],
  ['JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS', 86_400_000, 1000, 604_800_000, (c: Config) => c.jobs.notificationsCleanup.intervalMs],
  ['JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE', 1000, 1, 10_000, (c: Config) => c.jobs.notificationsCleanup.batchSize],
] as const;

describe.each(OPERATIONAL)('operational setting %s (R9.4)', (key, fallback, min, max, read) => {
  const configWith = (value: string) => {
    const result = parseConfig({ ...valid, [key]: value });
    return result.ok ? result.config : result.message;
  };

  it("defaults to today's value and takes an override", () => {
    const base = parseConfig(valid);
    expect(base.ok && read(base.config)).toBe(fallback);
    expect(read(configWith(String(min + 1)) as Config)).toBe(min + 1);
  });

  it('accepts both bounds', () => {
    expect(read(configWith(String(min)) as Config)).toBe(min);
    expect(read(configWith(String(max)) as Config)).toBe(max);
  });

  it('rejects values below the minimum and above the maximum, naming the key and not the value', () => {
    expect(configWith(String(min - 1))).toBe(`Invalid configuration: ${key} (too_small)`);
    expect(configWith(String(max + 1))).toBe(`Invalid configuration: ${key} (too_big)`);
  });

  it('rejects a non-integer without printing it', () => {
    const message = configWith('1500.5');
    expect(message).toContain(key);
    expect(message).not.toContain('1500.5');
  });
});
