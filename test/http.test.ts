import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setContractChecks } from '../src/http/checks.js';
import { DETAIL_CODES } from '../src/http/errors.js';
import { sendData, sendNoContent, sendPage } from '../src/http/respond.js';
import { validate } from '../src/http/validate.js';
import { testApp } from './helpers/app.js';
import { connectToTestDb } from './helpers/db.js';
import { captureLogs } from './helpers/log-capture.js';

const capture = captureLogs();
const pool = connectToTestDb(capture.logger);

// Test-only routes; production code ships no debug routes.
const testRouter = express.Router();
testRouter.post('/echo', (req, res) => {
  res.json({ received: req.body ?? null });
});
testRouter.post('/validated', (req, res) => {
  const body = validate(z.object({ email: z.email(), age: z.number() }), req.body);
  res.json(body);
});
testRouter.get('/boom', () => {
  throw new TypeError('secret internal detail');
});
testRouter.post('/duplicate-email', async (_req, res) => {
  const insert = "insert into users (email, user_name, password_hash) values ('dup@alnoor.test', 'Dup', 'x') on conflict do nothing";
  await pool.query(insert);
  await pool.query("insert into users (email, user_name, password_hash) values ('dup@alnoor.test', 'Dup', 'x')");
  res.json({});
});
// tenant_members_user_unique has no mapping: a second membership is a server bug, not a client error.
testRouter.post('/duplicate-membership', async (_req, res) => {
  const user = await pool.query<{ id: string }>("insert into users (email, user_name) values ('member-dup@alnoor.test', 'Dup') on conflict do nothing returning id");
  const userId = user.rows[0]?.id ?? (await pool.query<{ id: string }>("select id from users where email = 'member-dup@alnoor.test'")).rows[0]?.id;
  const tenant = await pool.query<{ id: string }>("insert into tenants (name, slug) values ('Dup', 'dup-member') on conflict (slug) do update set name = 'Dup' returning id");
  const role = await pool.query<{ id: string }>("insert into roles (tenant_id, name) values ($1, 'Dup') on conflict do nothing returning id", [tenant.rows[0]?.id]);
  const roleId = role.rows[0]?.id ?? (await pool.query<{ id: string }>('select id from roles where tenant_id = $1', [tenant.rows[0]?.id])).rows[0]?.id;
  const insert = 'insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3) on conflict do nothing';
  await pool.query(insert, [tenant.rows[0]?.id, userId, roleId]);
  await pool.query('insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)', [tenant.rows[0]?.id, userId, roleId]);
  res.json({});
});
testRouter.get('/async-boom', async () => {
  await Promise.resolve();
  throw new Error('async secret detail');
});
testRouter.get('/things/:thingId', (req, res) => {
  res.json({ thingId: req.params.thingId });
});
// The shape raw-body gives a body shorter or longer than its Content-Length, which a test client cannot send.
testRouter.post('/size-mismatch', () => {
  throw Object.assign(new Error('request size did not match content length'), {
    status: 400,
    statusCode: 400,
    expose: true,
    type: 'request.size.invalid',
  });
});

const itemSchema = z.strictObject({ id: z.number(), note: z.string().nullable() });
testRouter.get('/data-ok', (_req, res) => {
  sendData(res, 200, itemSchema, { id: 1, note: null });
});
testRouter.post('/data-created', (_req, res) => {
  sendData(res, 201, itemSchema, { id: 2, note: 'new' });
});
testRouter.get('/data-extra-key', (_req, res) => {
  sendData(res, 200, itemSchema, { id: 1, note: null, passwordHash: 'x' } as never);
});
testRouter.get('/page-ok', (_req, res) => {
  sendPage(res, itemSchema, { items: [{ id: 1, note: null }], nextCursor: 'abc', total: 7 });
});
testRouter.get('/page-bad-item', (_req, res) => {
  sendPage(res, itemSchema, {
    items: [{ id: '1', note: null } as never],
    nextCursor: null,
    total: 1,
  });
});
testRouter.get('/no-content', (_req, res) => {
  sendNoContent(res);
});
testRouter.post('/unregistered-refine', (req, res) => {
  const schema = z.object({ x: z.string() }).refine(() => false, { params: { code: 'made_up_code' } });
  res.json(validate(schema, req.body));
});

const app = testApp(pool, capture.logger, { routers: [testRouter] });

afterAll(async () => {
  await pool.end();
});

const SRC = join(import.meta.dirname, '..', 'src');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('standard error shape', () => {
  it('returns 404 NOT_FOUND for an unknown route', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', requestId: res.headers['x-request-id'], details: [] },
    });
  });

  it('returns 404 NOT_FOUND for a path parameter that cannot be decoded, as for any unknown ID', async () => {
    for (const path of ['/things/%E0%A4%A', '/things/%zz']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', requestId: res.headers['x-request-id'], details: [] },
      });
    }
  });

  it('returns 400 VALIDATION_FAILED for a body the parser refuses with a 400 of its own', async () => {
    const res = await request(app).post('/size-mismatch');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_FAILED', requestId: res.headers['x-request-id'], details: [] },
    });
  });

  it('returns 400 VALIDATION_FAILED for malformed JSON', async () => {
    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        requestId: res.headers['x-request-id'],
        details: [{ path: '', code: 'invalid_json' }],
      },
    });
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over 100 KB', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(101 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', requestId: res.headers['x-request-id'], details: [] },
    });
  });

  it('accepts a body just under the limit', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(90 * 1024) }));
    expect(res.status).toBe(200);
  });

  it('returns 415 UNSUPPORTED_MEDIA_TYPE for a body without a JSON content type', async () => {
    const res = await request(app).post('/echo').set('Content-Type', 'text/plain').send('hello');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        requestId: res.headers['x-request-id'],
        details: [],
      },
    });
  });

  it('returns 415 for a form-encoded body', async () => {
    const res = await request(app).post('/echo').type('form').send({ a: '1' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('allows a POST with no body and no content type', async () => {
    const res = await request(app).post('/echo');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: null });
  });

  it('returns 400 with {path, code} details for a validation failure', async () => {
    const res = await request(app).post('/validated').send({ email: 'not-an-email', age: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.error.details).toEqual([
      { path: 'email', code: 'invalid_format' },
      { path: 'age', code: 'invalid_type' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('message');
  });

  it('returns 500 INTERNAL with no internals in the body, and logs the stack', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL', requestId: res.headers['x-request-id'], details: [] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|TypeError|at /);

    const logged = capture.lines().find((line) => line.reqId === res.headers['x-request-id'] && line.err);
    const err = logged?.err as { stack?: string } | undefined;
    expect(err?.stack).toContain('secret internal detail');
  });

  it('translates a mapped unique violation centrally (users_email_unique to 409 TAKEN at email)', async () => {
    const res = await request(app).post('/duplicate-email');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'TAKEN',
        requestId: res.headers['x-request-id'],
        details: [{ path: 'email', code: 'taken' }],
      },
    });
  });

  it('returns 500 INTERNAL for a unique violation that has no mapping', async () => {
    const res = await request(app).post('/duplicate-membership');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('handles errors thrown from async handlers', async () => {
    const res = await request(app).get('/async-boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('does not turn health into an error', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('response helpers (R8.1, R8.16)', () => {
  it('wraps one item in data, with 200 or 201', async () => {
    const ok = await request(app).get('/data-ok');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ data: { id: 1, note: null } });
    const created = await request(app).post('/data-created');
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { id: 2, note: 'new' } });
  });

  it('writes a list as data and page', async () => {
    const res = await request(app).get('/page-ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ id: 1, note: null }],
      page: { nextCursor: 'abc', total: 7 },
    });
  });

  it('answers 204 with no body', async () => {
    const res = await request(app).get('/no-content');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('answers 500 INTERNAL and logs the schema issues with their paths when a value has an extra key', async () => {
    const res = await request(app).get('/data-extra-key').set('X-Request-Id', 'extra-key-1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const logged = capture.lines().find((line) => line.reqId === 'extra-key-1' && line.err);
    const err = logged?.err as { message?: string } | undefined;
    expect(err?.message).toContain('passwordHash');
  });

  it('checks every item of a list', async () => {
    const res = await request(app).get('/page-bad-item');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('sends the value as it is in production, where the check is off', async () => {
    setContractChecks(false);
    try {
      const res = await request(app).get('/data-extra-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { id: 1, note: null, passwordHash: 'x' } });
    } finally {
      setContractChecks(true);
    }
  });
});

describe('the detail-code registry (R8.11)', () => {
  it('makes validate() fail on a refine that names a code outside DETAIL_CODES', async () => {
    const res = await request(app).post('/unregistered-refine').send({ x: 'a' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('lists every code a schema refine names in the source', () => {
    const named = new Set<string>();
    for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.ts')) {
        continue;
      }
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const match of source.matchAll(/params:\s*\{\s*code:\s*"(\w+)"/g)) {
        named.add(match[1] ?? '');
      }
    }
    expect(named.size).toBeGreaterThan(10);
    expect([...named].filter((code) => !(DETAIL_CODES as readonly string[]).includes(code))).toEqual([]);
  });

  it('has no duplicates', () => {
    expect(new Set(DETAIL_CODES).size).toBe(DETAIL_CODES.length);
  });
});

describe('request IDs', () => {
  it('generates a UUID when none is sent', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('echoes a valid incoming ID', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'client-abc_1.2');
    expect(res.headers['x-request-id']).toBe('client-abc_1.2');
  });

  it.each([
    ['markup', '<script>alert(1)</script>'],
    ['too long', 'a'.repeat(65)],
    ['spaces', 'has space'],
  ])('replaces an invalid incoming ID (%s)', async (_label, bad) => {
    const res = await request(app).get('/health').set('X-Request-Id', bad);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('includes the request ID in error bodies', async () => {
    const res = await request(app).get('/nope').set('X-Request-Id', 'trace-42');
    expect(res.body.error.requestId).toBe('trace-42');
  });
});

describe('request logging', () => {
  it('puts the request ID on every log line of a request, matching the response header', async () => {
    const res = await request(app).get('/boom').set('X-Request-Id', 'log-check-1');
    expect(res.headers['x-request-id']).toBe('log-check-1');
    const lines = capture.lines().filter((line) => line.reqId === 'log-check-1');
    expect(lines.length).toBeGreaterThan(0);
    const mine = capture.lines().filter((line) => JSON.stringify(line).includes('log-check-1'));
    expect(mine.every((line) => line.reqId === 'log-check-1')).toBe(true);
  });

  it('redacts sensitive headers and fields', async () => {
    await request(app).get('/health').set('X-Request-Id', 'redact-1').set('Cookie', 'sid=supersecretcookie').set('Authorization', 'Bearer supersecrettoken').set('X-CSRF-Token', 'supersecretcsrf');
    const text = JSON.stringify(capture.lines().filter((line) => line.reqId === 'redact-1'));
    expect(text).toContain('[Redacted]');
    for (const secret of ['supersecretcookie', 'supersecrettoken', 'supersecretcsrf']) {
      expect(text).not.toContain(secret);
    }
  });

  it('redacts password fields in logged objects', () => {
    const local = captureLogs();
    local.logger.info({ password: 'hunter2', user: { password: 'hunter3', email: 'a@b.sa' } }, 'login attempt');
    const [line] = local.lines();
    expect(line).toMatchObject({
      password: '[Redacted]',
      user: { password: '[Redacted]', email: 'a@b.sa' },
    });
    expect(JSON.stringify(line)).not.toMatch(/hunter/);
  });

  it('redacts set-cookie on responses', async () => {
    const local = captureLogs();
    const cookieRouter = express.Router();
    cookieRouter.get('/cookie', (_req, res) => {
      res.setHeader('Set-Cookie', 'sid=supersecretsession; HttpOnly');
      res.json({});
    });
    await request(testApp(pool, local.logger, { routers: [cookieRouter] })).get('/cookie');
    const text = JSON.stringify(local.lines());
    expect(text).toContain('[Redacted]');
    expect(text).not.toContain('supersecretsession');
  });
});
