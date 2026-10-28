import { describe, expect, it } from 'vitest';
import { runMigrate } from './helpers/cli.js';

describe('db:migrate CLI', () => {
  it('runs with only DATABASE_URL set', async () => {
    const out = await runMigrate();
    expect(out.stderr).toBe('');
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('migrations applied');
  });

  it('exits 1 with the config message for a non-PostgreSQL DATABASE_URL, without printing it', async () => {
    const out = await runMigrate({ DATABASE_URL: 'mysql://u:topsecret@localhost/db' });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Invalid configuration: DATABASE_URL (custom)');
    expect(out.stderr).not.toContain('topsecret');
  });
});
