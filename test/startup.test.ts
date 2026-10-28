import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runMain(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // Minimal environment: nothing from the developer's shell or .env leaks into the child.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('startup', () => {
  it('exits with code 1 and names the missing key when DATABASE_URL is unset', async () => {
    const { code, output } = await runMain({});
    expect(code).toBe(1);
    expect(output).toContain('Invalid configuration: DATABASE_URL (Required)');
  });

  it('names invalid keys without printing their values', async () => {
    const { code, output } = await runMain({
      DATABASE_URL: 'postgres://u:topsecret@localhost:5432/db',
      PORT: 'abc',
    });
    expect(code).toBe(1);
    expect(output).toContain('PORT');
    expect(output).not.toContain('topsecret');
    expect(output).not.toContain('abc');
  });

  it('refuses to start when JOBS names an unknown job, naming it', async () => {
    const { code, output } = await runMain({
      DATABASE_URL: 'postgres://u:p@localhost:1/db',
      JWT_SECRET: 'a-jwt-secret-of-at-least-32-characters',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      EMAIL_FROM: 'Watheeq <no-reply@watheeq.sa>',
      APP_BASE_URL: 'http://localhost:5173',
      STORAGE_ENDPOINT: 'http://localhost:8333',
      STORAGE_BUCKET: 'watheeq-files',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
      JOBS: 'files.sweep,files.swep',
    });
    expect(code).toBe(1);
    expect(output).toContain('files.swep');
    expect(output).toContain('invalid JOBS setting');
  });

  // Phase 9 spec, 4.4 and section 5: the scheduler line is the first point after config, jobs, and listen, and it needs
  // no database (the jobs' first runs fail and are logged).
  describe('operational settings', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:1/db',
      JWT_SECRET: 'a-jwt-secret-of-at-least-32-characters',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      EMAIL_FROM: 'Watheeq <no-reply@watheeq.sa>',
      APP_BASE_URL: 'http://localhost:5173',
      STORAGE_ENDPOINT: 'http://localhost:8333',
      STORAGE_BUCKET: 'watheeq-files',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
      JOBS: 'files.sweep',
    };

    /** Runs the server until its output contains `marker`, then stops it with SIGTERM. */
    function runUntil(env: Record<string, string>, marker: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
          env: {
            PATH: process.env.PATH ?? '',
            PORT: String(20_000 + (process.pid % 20_000)),
            ...env,
          },
        });
        let output = '';
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(marker)) {
            child.kill('SIGTERM');
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', reject);
        child.on('close', () => resolve(output));
      });
    }

    const linesOf = (output: string) => output.split('\n').filter((text) => text.startsWith('{'));

    it("logs each selected job's effective settings on the scheduler line (R9.8)", async () => {
      const output = await runUntil({ ...base, JOB_FILES_SWEEP_BATCH_SIZE: '77', JOB_FILES_SWEEP_INTERVAL_MS: '300000' }, 'scheduler started');
      const line = linesOf(output)
        .map((text) => JSON.parse(text))
        .find((entry) => entry.msg === 'scheduler started');
      expect(line?.jobs).toEqual([{ name: 'files.sweep', intervalMs: 300_000, batchSize: 77, budgetMs: 120_000 }]);
      expect(output).not.toContain('unknown setting ignored');
      expect(output).not.toContain(base.STORAGE_SECRET_KEY);
    });

    it('warns once about an unknown JOB_ key and keeps starting (R9.7)', async () => {
      const output = await runUntil({ ...base, JOB_FILE_SWEEP_INTERVAL_MS: '300000' }, 'scheduler started');
      const warnings = linesOf(output).filter((text) => text.includes('unknown setting ignored'));
      expect(warnings).toHaveLength(1);
      expect(JSON.parse(warnings[0] ?? '{}')).toMatchObject({
        level: 40,
        keys: ['JOB_FILE_SWEEP_INTERVAL_MS'],
      });
      expect(output).toContain('scheduler started');
    });

    it('exits 1 naming the budget key when a budget is not below its interval (R9.5)', async () => {
      const { code, output } = await runMain({ ...base, JOB_FILES_SWEEP_BUDGET_MS: '900000' });
      expect(code).toBe(1);
      expect(output).toContain('JOB_FILES_SWEEP_BUDGET_MS (custom)');
      expect(output).not.toContain('900000');
    });
  });
});
