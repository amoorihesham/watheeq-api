import { afterAll, describe, expect, it } from 'vitest';
import { runCreateOperator as runCli } from './helpers/cli.js';
import { connectToTestDb } from './helpers/db.js';

const pool = connectToTestDb();

afterAll(async () => {
  await pool.end();
});

describe('operator:create CLI', () => {
  it('exits 1 with the config message for a non-PostgreSQL DATABASE_URL, without printing it', async () => {
    const out = await runCli(['a@watheeq.sa', 'A'], {
      DATABASE_URL: 'mysql://u:topsecret@localhost/db',
      OPERATOR_PASSWORD: 'cli-created-password-1',
    });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Invalid configuration: DATABASE_URL (custom)');
    expect(out.stderr).not.toContain('topsecret');
  });

  it('creates an active operator with a normalized email and an argon2id hash, and echoes no secret', async () => {
    const out = await runCli(['Omar@Watheeq.SA', '  Omar Al-Harbi '], {
      OPERATOR_PASSWORD: 'cli-created-password-1',
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('omar@watheeq.sa');
    expect(out.stdout + out.stderr).not.toContain('cli-created-password-1');
    const { rows } = await pool.query("select role, is_active, user_name, password_hash from users where email = 'omar@watheeq.sa'");
    expect(rows[0]).toMatchObject({
      role: 'operator',
      is_active: true,
      user_name: 'Omar Al-Harbi',
    });
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const members = await pool.query("select count(*)::int as n from tenant_members m join users u on u.id = m.user_id where u.email = 'omar@watheeq.sa'");
    expect(members.rows[0].n).toBe(0);
  });

  it('refuses a duplicate email, an invalid email, a short password, and extra arguments', async () => {
    await runCli(['dup@watheeq.sa', 'Dup'], { OPERATOR_PASSWORD: 'another-password-123' });
    const dup = await runCli(['dup@watheeq.sa', 'Dup'], {
      OPERATOR_PASSWORD: 'another-password-123',
    });
    expect(dup.code).toBe(1);
    expect(dup.stderr).toContain('already exists');
    const bad = await runCli(['not-an-email', 'Bad'], {
      OPERATOR_PASSWORD: 'another-password-123',
    });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('Invalid email');
    const short = await runCli(['short@watheeq.sa', 'Short'], { OPERATOR_PASSWORD: 'short' });
    expect(short.code).toBe(1);
    expect(short.stderr).toContain('Invalid password');
    const long = await runCli(['long@watheeq.sa', 'Long'], { OPERATOR_PASSWORD: 'x'.repeat(257) });
    expect(long.code).toBe(1);
    expect(long.stderr).toContain('Invalid password');
    const argvPassword = await runCli(['argv@watheeq.sa', 'Argv', 'secret-in-argv-123'], {});
    expect(argvPassword.code).toBe(1);
    expect(argvPassword.stderr).toContain('Usage');
    const { rows } = await pool.query("select count(*)::int as n from users where email in ('not-an-email', 'short@watheeq.sa', 'long@watheeq.sa', 'argv@watheeq.sa')");
    expect(rows[0].n).toBe(0);
  });

  it('refuses a missing name', async () => {
    const out = await runCli(['noname@watheeq.sa'], { OPERATOR_PASSWORD: 'another-password-123' });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Usage');
  });

  it('fails without a password source when stdin is not a terminal', async () => {
    const out = await runCli(['nopass@watheeq.sa', 'No Pass'], {});
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('OPERATOR_PASSWORD');
  });
});
