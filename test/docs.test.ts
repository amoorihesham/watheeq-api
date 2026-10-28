import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { testApp } from './helpers/app.js';
import { connectToTestDb } from './helpers/db.js';

const pool = connectToTestDb();
afterAll(() => pool.end());

const outside = testApp(pool, createLogger('silent'));
const production = testApp(pool, createLogger('silent'), { config: { NODE_ENV: 'production' } });

describe('the API reference outside production (R10.10)', () => {
  it('serves the committed document at /openapi.json', async () => {
    const res = await request(outside).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
  });

  it('serves the reference page at /docs, loading its script from the same origin', async () => {
    const res = await request(outside).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/openapi.json');
    expect([...res.text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((match) => match[0])).toEqual([]);
    expect(res.text).toContain('src="/docs/scalar.js"');
  });

  it("turns off the page's features that send the document to Scalar's servers", async () => {
    const res = await request(outside).get('/docs');
    const config = /createApiReference\('#app', (\{[\s\S]*?\n\s*\})\)/.exec(res.text)?.[1];
    expect(JSON.parse(config ?? '{}')).toMatchObject({
      agent: { disabled: true },
      mcp: { disabled: true },
      telemetry: false,
    });
  });

  it('serves the script the page loads', async () => {
    const res = await request(outside).get('/docs/scalar.js').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(100_000);
  });
});

describe('the API reference in production (R10.10)', () => {
  it.each(['/docs', '/docs/scalar.js', '/openapi.json'])('answers 404 NOT_FOUND at %s', async (path) => {
    const res = await request(production).get(path);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.details).toEqual([]);
    expect(typeof res.body.error.requestId).toBe('string');
  });
});
