import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logging/logger.js';
import { testApp } from '../helpers/app.js';
import { connectToTestDb } from '../helpers/db.js';
import { apiDocs, specStatus, tableRows } from './markdown-tables.js';
import { normalize, routesOfApp } from './route-walker.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function routesOfDocs(): { routes: string[]; malformed: string[] } {
  const routes: string[] = [];
  const malformed: string[] = [];
  for (const { path: file, text } of apiDocs()) {
    for (const [method = '', pathCell = ''] of tableRows(text)) {
      if (!METHODS.some((name) => method.startsWith(name))) {
        continue;
      }
      const path = /^`(\/[^`]*)`$/.exec(pathCell)?.[1];
      if (!METHODS.includes(method) || path === undefined || path.includes('?')) {
        malformed.push(`${file}: ${method} ${pathCell}`);
        continue;
      }
      routes.push(`${method} ${normalize(path)}`);
    }
  }
  return { routes, malformed };
}

const pool = connectToTestDb();
afterAll(() => pool.end());

describe('routes and the .API.md tables (C5)', () => {
  const mounted = () => [
    ...new Set(
      routesOfApp(() => testApp(pool, createLogger('silent'))).map((route) => {
        const [method = '', path = ''] = route.split(' ');
        return `${method} ${normalize(path)}`;
      }),
    ),
  ];

  it('lists the routes of the real app', () => {
    // A sanity check of the listing itself, so an empty or wrong walk cannot pass the comparison below.
    const routes = mounted();
    expect(routes).toContain('GET /health');
    expect(routes).toContain('POST /requests/:param/accept');
    expect(routes).toContain('PUT /calendar/hours/:param');
    expect(routes.length).toBeGreaterThan(80);
  });

  it('has a table row for every mounted route', () => {
    const documented = new Set(routesOfDocs().routes);
    const missing = mounted().filter((route) => !documented.has(route));
    expect(missing).toEqual([]);
  });

  it('has a mounted route for every table row', () => {
    const real = new Set(mounted());
    const unknown = routesOfDocs().routes.filter((route) => !real.has(route));
    expect(unknown).toEqual([]);
  });

  it('writes every row as a method and a full path without a query string', () => {
    expect(routesOfDocs().malformed).toEqual([]);
  });
});

describe('which .API.md tables C5 reads (Phase 10, Q15)', () => {
  it('skips the table of a Draft spec and reads the table of an Implemented one', () => {
    const files = apiDocs('test/fixtures/specs').map((doc) => doc.path);
    expect(files).toEqual(['test/fixtures/specs/phase-y-done/phase-y-done.API.md']);
  });

  it('reads the status row of a spec', () => {
    expect(specStatus('| **Status** | In Implementation |\n')).toBe('In Implementation');
    expect(specStatus('no table')).toBeUndefined();
  });
});
