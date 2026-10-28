import { describe, expect, it } from 'vitest';
import { type Config, parseCliConfig, parseConfig, unknownJobKeys } from '../src/config/config.js';

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
        server: { env: 'development', port: 3000, logLevel: 'info', shutdownTimeoutMs: 10_000 },
        database: { url: valid.DATABASE_URL, timeoutMs: 2000 },
        auth: {
          jwtSecret: valid.JWT_SECRET,
          accessTokenTtlSeconds: 1800,
          refreshTokenTtlSeconds: 604800,
        },
        links: {
          appBaseUrl: valid.APP_BASE_URL,
          invitationTtlSeconds: 259200,
          passwordResetTtlSeconds: 3600,
        },
        email: {
          host: 'localhost',
          port: 1025,
          secure: false,
          user: undefined,
          password: undefined,
          from: valid.EMAIL_FROM,
        },
        storage: {
          endpoint: valid.STORAGE_ENDPOINT,
          region: 'us-east-1',
          bucket: valid.STORAGE_BUCKET,
          accessKey: valid.STORAGE_ACCESS_KEY,
          secretKey: valid.STORAGE_SECRET_KEY,
          forcePathStyle: false,
          uploadQueueSize: 2,
        },
        jobs: {
          enabled: 'all',
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
      auth: { accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600 },
      links: { invitationTtlSeconds: 7200, passwordResetTtlSeconds: 600 },
      email: { secure: true, user: 'mailer', password: 'mail-pass' },
      storage: { region: 'me-south-1', forcePathStyle: true },
      jobs: { enabled: ['files.sweep'] },
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
    expect(ok.ok && ok.config.auth.accessTokenTtlSeconds).toBe(900);
    expect(parseConfig({ ...valid, REFRESH_TOKEN_TTL_SECONDS: '59' })).toEqual({
      ok: false,
      message: 'Invalid configuration: REFRESH_TOKEN_TTL_SECONDS (too_small)',
    });
  });

  it("reads SMTP_SECURE as a boolean, and only from 'true' or 'false'", () => {
    const on = parseConfig({ ...valid, SMTP_SECURE: 'true' });
    expect(on.ok && on.config.email.secure).toBe(true);
    const off = parseConfig({ ...valid, SMTP_SECURE: 'false' });
    expect(off.ok && off.config.email.secure).toBe(false);
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
    expect(on.ok && on.config.storage.forcePathStyle).toBe(true);
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
      return result.ok ? result.config.jobs.enabled : result.message;
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
        'Invalid configuration: DATABASE_URL (Required), JWT_SECRET (Required), SMTP_HOST (Required), SMTP_PORT (Required), EMAIL_FROM (Required), APP_BASE_URL (Required), STORAGE_ENDPOINT (Required), STORAGE_BUCKET (Required), STORAGE_ACCESS_KEY (Required), STORAGE_SECRET_KEY (Required)',
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
      config: { database: { url: valid.DATABASE_URL }, operatorPassword: undefined },
    });
  });

  it('reads OPERATOR_PASSWORD when set and rejects an empty one', () => {
    const set = parseCliConfig({ DATABASE_URL: valid.DATABASE_URL, OPERATOR_PASSWORD: 'pw' });
    expect(set.ok && set.config.operatorPassword).toBe('pw');
    expect(parseCliConfig({ DATABASE_URL: valid.DATABASE_URL, OPERATOR_PASSWORD: '' }).ok).toBe(false);
  });

  it('names a non-PostgreSQL DATABASE_URL without printing it', () => {
    const result = parseCliConfig({ DATABASE_URL: 'mysql://u:topsecret@host/db' });
    expect(result).toEqual({ ok: false, message: 'Invalid configuration: DATABASE_URL (custom)' });
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
  ['SHUTDOWN_TIMEOUT_MS', 10_000, 1000, 300_000, (c: Config) => c.server.shutdownTimeoutMs],
  ['DATABASE_TIMEOUT_MS', 2000, 100, 60_000, (c: Config) => c.database.timeoutMs],
  ['STORAGE_UPLOAD_QUEUE_SIZE', 2, 1, 10, (c: Config) => c.storage.uploadQueueSize],
  ['JOB_REQUESTS_ESCALATIONS_INTERVAL_MS', 60_000, 1000, 604_800_000, (c: Config) => c.jobs.escalations.intervalMs],
  ['JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS', 3_600_000, 1000, 604_800_000, (c: Config) => c.jobs.subscriptionNotices.intervalMs],
  ['JOB_FILES_SWEEP_INTERVAL_MS', 900_000, 1000, 604_800_000, (c: Config) => c.jobs.fileSweep.intervalMs],
  ['JOB_FILES_SWEEP_BATCH_SIZE', 100, 1, 10_000, (c: Config) => c.jobs.fileSweep.batchSize],
  ['JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS', 86_400_000, 1000, 604_800_000, (c: Config) => c.jobs.tokenCleanup.intervalMs],
  ['JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE', 1000, 1, 10_000, (c: Config) => c.jobs.tokenCleanup.batchSize],
  ['JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS', 86_400_000, 1000, 604_800_000, (c: Config) => c.jobs.notificationsCleanup.intervalMs],
  ['JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE', 1000, 1, 10_000, (c: Config) => c.jobs.notificationsCleanup.batchSize],
] as const;

// An interval override must leave room for the default budget; at the minimum interval of 1,000 no budget fits, so
// these two intervals are tested from 1,001 up with the budget lowered to its own minimum.
const LOWERED_BUDGET: Record<string, Record<string, string>> = {
  JOB_REQUESTS_ESCALATIONS_INTERVAL_MS: { JOB_REQUESTS_ESCALATIONS_BUDGET_MS: '1000' },
  JOB_FILES_SWEEP_INTERVAL_MS: { JOB_FILES_SWEEP_BUDGET_MS: '1000' },
};

describe.each(OPERATIONAL)('operational setting %s (R9.4)', (key, fallback, min, max, read) => {
  const lowest = key in LOWERED_BUDGET ? min + 1 : min;
  const configWith = (value: string) => {
    const result = parseConfig({ ...valid, ...LOWERED_BUDGET[key], [key]: value });
    return result.ok ? result.config : result.message;
  };

  it("defaults to today's value and takes an override", () => {
    const base = parseConfig(valid);
    expect(base.ok && read(base.config)).toBe(fallback);
    expect(read(configWith(String(lowest + 1)) as Config)).toBe(lowest + 1);
  });

  it('accepts both bounds', () => {
    expect(read(configWith(String(lowest)) as Config)).toBe(lowest);
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

describe('job budgets (R9.5)', () => {
  const PAIRS = [
    ['JOB_REQUESTS_ESCALATIONS_BUDGET_MS', 'JOB_REQUESTS_ESCALATIONS_INTERVAL_MS'],
    ['JOB_FILES_SWEEP_BUDGET_MS', 'JOB_FILES_SWEEP_INTERVAL_MS'],
  ] as const;

  it.each(PAIRS)('%s equal to its interval fails, naming the budget key', (budget, interval) => {
    expect(parseConfig({ ...valid, [interval]: '5000', [budget]: '5000' })).toEqual({
      ok: false,
      message: `Invalid configuration: ${budget} (custom)`,
    });
  });

  it.each(PAIRS)('%s above its interval fails without printing the value', (budget, interval) => {
    const result = parseConfig({ ...valid, [interval]: '5000', [budget]: '7777' });
    expect(result).toEqual({ ok: false, message: `Invalid configuration: ${budget} (custom)` });
  });

  it.each(PAIRS)('%s alone at its default interval fails', (budget, interval) => {
    const defaultInterval = parseConfig(valid);
    expect(defaultInterval.ok).toBe(true);
    const atInterval = {
      ...valid,
      [budget]: interval.includes('ESCALATIONS') ? '60000' : '900000',
    };
    expect(parseConfig(atInterval)).toEqual({
      ok: false,
      message: `Invalid configuration: ${budget} (custom)`,
    });
  });

  it('lowering an interval below the default budget fails until the budget is lowered too', () => {
    const interval = { JOB_REQUESTS_ESCALATIONS_INTERVAL_MS: '30000' };
    expect(parseConfig({ ...valid, ...interval }).ok).toBe(false);
    expect(parseConfig({ ...valid, ...interval, JOB_REQUESTS_ESCALATIONS_BUDGET_MS: '20000' }).ok).toBe(true);
  });

  it('rejects a budget under one second', () => {
    expect(parseConfig({ ...valid, JOB_FILES_SWEEP_BUDGET_MS: '999' })).toEqual({
      ok: false,
      message: 'Invalid configuration: JOB_FILES_SWEEP_BUDGET_MS (too_small)',
    });
  });
});

describe('unknownJobKeys (R9.7)', () => {
  it('reports JOB_ keys the schema does not know, such as a typo', () => {
    expect(unknownJobKeys({ JOB_FILE_SWEEP_INTERVAL_MS: '1000', JOB_NAME: 'x', PATH: '/bin' })).toEqual(['JOB_FILE_SWEEP_INTERVAL_MS', 'JOB_NAME']);
  });

  it('does not report JOBS or the real job keys', () => {
    const real = Object.fromEntries(
      [
        'JOBS',
        'JOB_REQUESTS_ESCALATIONS_INTERVAL_MS',
        'JOB_REQUESTS_ESCALATIONS_BUDGET_MS',
        'JOB_SUBSCRIPTIONS_NOTICES_INTERVAL_MS',
        'JOB_FILES_SWEEP_INTERVAL_MS',
        'JOB_FILES_SWEEP_BATCH_SIZE',
        'JOB_FILES_SWEEP_BUDGET_MS',
        'JOB_AUTH_TOKEN_CLEANUP_INTERVAL_MS',
        'JOB_AUTH_TOKEN_CLEANUP_BATCH_SIZE',
        'JOB_NOTIFICATIONS_CLEANUP_INTERVAL_MS',
        'JOB_NOTIFICATIONS_CLEANUP_BATCH_SIZE',
      ].map((key) => [key, '1']),
    );
    expect(unknownJobKeys(real)).toEqual([]);
  });
});
