import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessageType, EmailSenderType } from '../src/email/index.js';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { accessCookie, hashPassword, login, refreshCookie } from './helpers/auth.js';
import { TEST_APP_BASE_URL } from './helpers/config.js';
import { connectToTestDb, seedSubscribedTenant, seedUser } from './helpers/db.js';
import { createFakeEmailSender } from './helpers/email.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';
const OMAR = 'omar@pw-watheeq.test';
const SARA = 'sara@pw-alnoor.test';
const INVITED = 'invited@pw-alnoor.test';
const LEFT = 'left@pw-alnoor.test';

const pool = connectToTestDb();
const email = createFakeEmailSender();

// Holds every send until released, to show the reset request answers before any email work happens.
let gate: Promise<void> | undefined;
const gatedSender: EmailSenderType = {
  async send(message: EmailMessageType) {
    await gate;
    await email.sender.send(message);
  },
};
const app = testApp(pool, createLogger('silent'), { emailSender: gatedSender });

let counter = 0;
let tenantId = '';
let memberRoleId = '';
let passwordHash = '';

/** A verified, active member of Al-Noor with PASSWORD; returns their email. */
async function newUser(): Promise<string> {
  const address = `user${++counter}@pw-alnoor.test`;
  const id = await seedUser(pool, { email: address, passwordHash });
  await pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [tenantId, id, memberRoleId]);
  return address;
}

const changePassword = (access: string, body: object, refresh = '') =>
  request(app)
    .post('/auth/password')
    .set('Cookie', [accessCookie(access), refreshCookie(refresh)])
    .send(body);

const requestReset = (address: string) => request(app).post('/auth/password-reset/request').send({ email: address });

const reset = (token: string, password = NEW_PASSWORD) => request(app).post('/auth/password-reset').send({ token, password });

const refresh = (token: string) => request(app).post('/auth/refresh').set('Cookie', refreshCookie(token));

/** Waits for the email that is sent after the 204. */
async function resetTokenFor(address: string, previous = ''): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const token = email.lastTokenFor(address);
    if (token && token !== previous) {
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return '';
}

const auditActions = (userId: string) => pool.query('select action, actor_type from audit_log where resource_id = $1 order by id', [userId]).then((result) => result.rows);

const idOf = async (address: string) => (await pool.query('select id from users where email = $1', [address])).rows[0].id as string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  await seedUser(pool, { email: OMAR, passwordHash, role: 'operator' });
  ({ id: tenantId, memberRoleId } = await seedSubscribedTenant(pool, 'pw-al-noor', [
    { email: SARA, passwordHash },
    { email: INVITED, verified: false },
    { email: LEFT, passwordHash, isActive: false },
  ]));
});

afterAll(async () => {
  await pool.end();
});

describe('changing a password (R2.16)', () => {
  it('sets the new password, keeps this session, and signs out the others', async () => {
    const address = await newUser();
    const laptop = await login(app, address, PASSWORD);
    const phone = await login(app, address, PASSWORD);

    const res = await changePassword(laptop.access, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, laptop.refresh);
    expect(res.status).toBe(204);
    expect((await login(app, address, PASSWORD)).res.status).toBe(401);
    expect((await login(app, address, NEW_PASSWORD)).res.status).toBe(200);
    expect((await refresh(phone.refresh)).status).toBe(401);
    expect((await refresh(laptop.refresh)).status).toBe(200);
    expect(await auditActions(await idOf(address))).toEqual([{ action: 'user.password_changed', actor_type: 'user' }]);
  });

  it('refuses a wrong current password with 401 and changes nothing', async () => {
    const address = await newUser();
    const session = await login(app, address, PASSWORD);
    const res = await changePassword(session.access, {
      currentPassword: 'not my password',
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(app, address, PASSWORD)).res.status).toBe(200);
  });

  it('refuses a new password shorter than 12 characters', async () => {
    const session = await login(app, await newUser(), PASSWORD);
    const res = await changePassword(session.access, {
      currentPassword: PASSWORD,
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('needs a session', async () => {
    const res = await request(app).post('/auth/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('works for an operator, audited without a tenant', async () => {
    const session = await login(app, OMAR, PASSWORD);
    expect(
      (
        await changePassword(session.access, {
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(204);
    expect(await auditActions(await idOf(OMAR))).toEqual([{ action: 'user.password_changed', actor_type: 'operator' }]);
  });

  it('works while the tenant is Read-only', async () => {
    const address = await newUser();
    const session = await login(app, address, PASSWORD);
    await pool.query('update subscriptions set start_date = current_date - 400, end_date = current_date - 100 where tenant_id = $1', [tenantId]);
    try {
      const res = await changePassword(session.access, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(204);
    } finally {
      await pool.query('update subscriptions set start_date = current_date, end_date = current_date + 365 where tenant_id = $1', [tenantId]);
    }
  });
});

describe('requesting a reset (R2.17, P2.7)', () => {
  it('emails an active user a reset link', async () => {
    const address = await newUser();
    expect((await requestReset(address)).status).toBe(204);
    const token = await resetTokenFor(address);
    expect(token).not.toBe('');
    const message = email.sent.filter((m) => m.to === address).at(-1);
    expect(message?.text).toContain(`${TEST_APP_BASE_URL}/reset-password?token=${token}`);
  });

  it('answers before any email work is done', async () => {
    const address = await newUser();
    let open: () => void = () => {};
    gate = new Promise((resolve) => {
      open = resolve;
    });
    try {
      expect((await requestReset(address)).status).toBe(204);
      expect(email.lastTokenFor(address)).toBe('');
    } finally {
      open();
      gate = undefined;
    }
    expect(await resetTokenFor(address)).not.toBe('');
  });

  it('answers the same 204 and sends nothing for an unknown, invited, or deactivated email', async () => {
    for (const address of ['nobody@pw-alnoor.test', INVITED, LEFT]) {
      const res = await requestReset(address);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const address of ['nobody@pw-alnoor.test', INVITED, LEFT]) {
      expect(email.lastTokenFor(address)).toBe('');
    }
  });

  it('refuses a malformed email with 400', async () => {
    expect((await requestReset('not-an-email')).status).toBe(400);
  });
});

describe('using a reset link (R2.17)', () => {
  it('sets the new password, signs out every session, and audits it', async () => {
    const address = await newUser();
    const session = await login(app, address, PASSWORD);
    await requestReset(address);
    const res = await reset(await resetTokenFor(address));
    expect(res.status).toBe(204);
    expect((await login(app, address, NEW_PASSWORD)).res.status).toBe(200);
    expect((await login(app, address, PASSWORD)).res.status).toBe(401);
    expect((await refresh(session.refresh)).status).toBe(401);
    expect((await auditActions(await idOf(address))).at(-1)).toEqual({
      action: 'user.password_reset',
      actor_type: 'user',
    });
  });

  it('works once', async () => {
    const address = await newUser();
    await requestReset(address);
    const token = await resetTokenFor(address);
    expect((await reset(token)).status).toBe(204);
    const again = await reset(token, 'yet another passphrase');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('VERIFICATION_INVALID');
  });

  it('stops working when a newer link is requested', async () => {
    const address = await newUser();
    await requestReset(address);
    const first = await resetTokenFor(address);
    await requestReset(address);
    const second = await resetTokenFor(address, first);
    expect((await reset(first)).body.error.code).toBe('VERIFICATION_INVALID');
    expect((await reset(second)).status).toBe(204);
  });

  it('expires', async () => {
    const address = await newUser();
    await requestReset(address);
    const token = await resetTokenFor(address);
    await pool.query("update password_tokens set expires_at = now() - interval '1 second' where user_id = (select id from users where email = $1)", [address]);
    expect((await reset(token)).body.error.code).toBe('VERIFICATION_INVALID');
  });

  it('lasts one hour by default', async () => {
    const address = await newUser();
    await requestReset(address);
    await resetTokenFor(address);
    const { rows } = await pool.query("select extract(epoch from expires_at - created_at)::int as ttl from password_tokens where user_id = (select id from users where email = $1) and purpose = 'reset'", [address]);
    expect(rows[0].ttl).toBe(3600);
  });

  it('never accepts an invitation link, and the verify endpoint never accepts a reset link', async () => {
    const address = await newUser();
    await requestReset(address);
    const resetToken = await resetTokenFor(address);
    const verify = await request(app).post('/auth/verify').send({ token: resetToken, password: NEW_PASSWORD });
    expect(verify.body.error.code).toBe('VERIFICATION_INVALID');

    const admin = await login(app, SARA, PASSWORD);
    const invitee = `invitee${++counter}@pw-alnoor.test`;
    await request(app).post('/users').set('Cookie', accessCookie(admin.access)).send({ email: invitee, userName: 'Invitee', roleId: memberRoleId });
    expect((await reset(email.lastTokenFor(invitee))).body.error.code).toBe('VERIFICATION_INVALID');
  });

  it('refuses a user deactivated after requesting the link', async () => {
    const address = await newUser();
    await requestReset(address);
    const token = await resetTokenFor(address);
    await pool.query('update users set is_active = false where email = $1', [address]);
    expect((await reset(token)).body.error.code).toBe('VERIFICATION_INVALID');
  });

  it('refuses a short password before touching the link', async () => {
    const address = await newUser();
    await requestReset(address);
    const token = await resetTokenFor(address);
    expect((await reset(token, 'short')).status).toBe(400);
    expect((await reset(token)).status).toBe(204);
  });
});
