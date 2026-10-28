import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { connectToTestDb } from './helpers/db.js';

describe('GET /health', () => {
  const logger = createLogger('silent');
  const upPool = connectToTestDb(logger);
  // Port 1 is reserved and nothing listens on it, so connections are refused.
  const downPool = createPool({ url: 'postgres://watheeq:watheeq@127.0.0.1:1/watheeq', timeoutMs: 2000 }, logger);

  afterAll(async () => {
    await Promise.all([upPool.end(), downPool.end()]);
  });

  it('returns 200 with db up when PostgreSQL is reachable', async () => {
    const res = await request(testApp(upPool, logger)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok', db: 'up' } });
  });

  it('returns 503 with db down, within the timeout, when PostgreSQL is unreachable', async () => {
    const started = Date.now();
    const res = await request(testApp(downPool, logger)).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        requestId: res.headers['x-request-id'],
        details: [],
      },
    });
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
