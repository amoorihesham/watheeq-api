import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apis } from '../src/http/apis.js';
import { defineApi, defineEndpoint } from '../src/http/endpoint.js';
import { idFilter } from '../src/http/filters.js';
import { buildOpenApi } from '../src/http/openapi.js';
import { idSchema } from '../src/http/validate.js';

interface OperationType {
  security?: unknown;
  'x-permission'?: string;
  parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[];
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: unknown }> }>;
}
interface DocumentType {
  paths: Record<string, Record<string, OperationType>>;
  components: { schemas: Record<string, Record<string, unknown>>; securitySchemes: unknown };
}

const viewSchema = z.strictObject({ id: z.string(), openedAt: z.date(), closedAt: z.date().nullable() }).meta({ id: 'TestView' });
const params = z.strictObject({ itemId: idSchema });

const sample = defineApi({
  tag: 'sample',
  prefix: '/sample',
  realm: 'tenant',
  endpoints: {
    list: defineEndpoint({
      method: 'get',
      path: '/',
      summary: 'List',
      query: z.strictObject({ owner: idFilter({ none: true }), active: z.boolean().optional() }),
      response: { kind: 'page', schema: viewSchema },
    }),
    open: defineEndpoint({
      method: 'post',
      path: '/:itemId/open',
      summary: 'Open',
      permission: { tenant: 'request.review' },
      activeSubscription: true,
      params,
      body: z.strictObject({ note: z.string() }),
      response: { kind: 'data', status: 200, schema: viewSchema },
      errors: ['INVALID_REQUEST_STATE'],
    }),
    upload: defineEndpoint({
      method: 'post',
      path: '/files',
      summary: 'Upload',
      body: { kind: 'binary' },
      response: { kind: 'data', status: 201, schema: viewSchema },
      errors: ['FILE_TOO_LARGE'],
    }),
    content: defineEndpoint({
      method: 'get',
      path: '/:itemId/content',
      summary: 'Download',
      params,
      response: { kind: 'download' },
    }),
  },
});

const inbox = defineApi({
  tag: 'inbox',
  prefix: '/inbox',
  realm: 'tenantInbox',
  endpoints: {
    clear: defineEndpoint({
      method: 'post',
      path: '/clear',
      summary: 'Clear',
      response: { kind: 'noContent' },
    }),
  },
});

const platform = defineApi({
  tag: 'platform',
  prefix: '/platform',
  realm: 'operator',
  endpoints: {
    make: defineEndpoint({
      method: 'post',
      path: '/make',
      summary: 'Make',
      permission: { platform: 'platform.plan.create' },
      response: { kind: 'noContent' },
    }),
  },
});

const doc = buildOpenApi([sample, inbox, platform, ...apis]) as unknown as DocumentType;
const operation = (path: string, method: string) => {
  const found = doc.paths[path]?.[method];
  if (!found) {
    throw new Error(`no operation ${method} ${path}`);
  }
  return found;
};
const codesAt = (op: OperationType, status: string) => op.responses[status]?.description;

describe('security and implied errors (R10.8)', () => {
  it('leaves a public operation without security and without 401 or 403', () => {
    const login = operation('/auth/login', 'post');
    expect(login.security).toBeUndefined();
    expect(Object.keys(login.responses)).toEqual(['200', '400', '401', '413', '415', '500']);
    expect(codesAt(login, '401')).toBe('`INVALID_CREDENTIALS`');
  });

  it('requires the cookie for a session operation, with no 403', () => {
    const me = operation('/auth/me', 'get');
    expect(me.security).toEqual([{ cookieAuth: [] }]);
    expect(Object.keys(me.responses)).toEqual(['200', '401', '500']);
    expect(doc.components.securitySchemes).toEqual({
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'wq_access' },
    });
  });

  it('lists what a tenant write with a permission, a body, and params implies', () => {
    const open = operation('/sample/{itemId}/open', 'post');
    expect(open.security).toEqual([{ cookieAuth: [] }]);
    expect(open['x-permission']).toBe('request.review');
    expect(codesAt(open, '401')).toBe('`UNAUTHENTICATED`');
    expect(codesAt(open, '403')).toBe('`FORBIDDEN`, `SUBSCRIPTION_READ_ONLY`, `SUBSCRIPTION_NOT_ACTIVE`');
    expect(codesAt(open, '400')).toBe('`VALIDATION_FAILED`');
    expect(codesAt(open, '404')).toBe('`NOT_FOUND`');
    expect(codesAt(open, '409')).toBe('`INVALID_REQUEST_STATE`');
    expect(codesAt(open, '500')).toBe('`INTERNAL`');
  });

  it('does not add the Read-only code to a tenant GET, and adds it to nothing in the inbox realm', () => {
    expect(codesAt(operation('/sample', 'get'), '403')).toBe('`FORBIDDEN`');
    expect(codesAt(operation('/inbox/clear', 'post'), '403')).toBe('`FORBIDDEN`');
  });

  it('requires the cookie and FORBIDDEN in the operator realm and names the platform permission', () => {
    const make = operation('/platform/make', 'post');
    expect(make['x-permission']).toBe('platform.plan.create');
    expect(codesAt(make, '403')).toBe('`FORBIDDEN`');
  });

  it('describes a health check with no security and its declared 503', () => {
    const health = operation('/health', 'get');
    expect(health.security).toBeUndefined();
    expect(codesAt(health, '503')).toBe('`SERVICE_UNAVAILABLE`');
  });
});

describe('schemas', () => {
  it('describes a Date as a date-time string, in a response, a list item, and nullable', () => {
    const view = doc.components.schemas.TestView as { properties: Record<string, unknown> };
    expect(view.properties.openedAt).toEqual({ type: 'string', format: 'date-time' });
    expect(view.properties.closedAt).toEqual({
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    });
  });

  it('gives an idFilter query parameter a type and its default', () => {
    const owner = operation('/sample', 'get').parameters?.find((p) => p.name === 'owner');
    expect(owner).toMatchObject({ in: 'query', required: false, schema: { type: 'string' } });
    expect(owner?.schema.default).toBe('all');
  });

  it('wraps a list in data and page and marks an optional query parameter not required', () => {
    const list = operation('/sample', 'get');
    expect(list.parameters?.find((p) => p.name === 'active')?.required).toBe(false);
    expect(list.responses['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['data', 'page'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/TestView' } },
        page: { $ref: '#/components/schemas/Page' },
      },
    });
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['Page', 'Error', 'ErrorDetail']));
  });

  it('writes path parameters as required parameters of the path', () => {
    const open = operation('/sample/{itemId}/open', 'post');
    expect(open.parameters).toMatchObject([{ name: 'itemId', in: 'path', required: true }]);
  });
});

describe('binary bodies and downloads', () => {
  it('describes the raw upload as a binary body with no JSON limits', () => {
    const upload = operation('/sample/files', 'post');
    expect(upload.requestBody?.content).toEqual({
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    });
    expect(Object.keys(upload.responses)).toEqual(['201', '401', '403', '413', '500']);
    expect(codesAt(upload, '413')).toBe('`FILE_TOO_LARGE`');
  });

  it('describes a download as a binary response', () => {
    const content = operation('/sample/{itemId}/content', 'get');
    expect(content.responses['200']?.content).toEqual({
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    });
  });
});

describe('determinism and refusals', () => {
  it('builds the same bytes twice', () => {
    expect(JSON.stringify(buildOpenApi(apis))).toBe(JSON.stringify(buildOpenApi(apis)));
  });

  it('refuses a schema it cannot describe, naming where', () => {
    const bad = defineApi({
      tag: 'bad',
      prefix: '/bad',
      realm: 'open',
      endpoints: {
        one: defineEndpoint({
          method: 'get',
          path: '/',
          summary: 'x',
          response: { kind: 'data', status: 200, schema: z.strictObject({ n: z.bigint() }) },
        }),
      },
    });
    expect(() => buildOpenApi([bad])).toThrow(/bad.one response cannot be described: bigint at/);
  });

  it('refuses two different schemas with one component id', () => {
    const twin = (shape: z.ZodRawShape) => z.strictObject(shape).meta({ id: 'Twin' });
    const bad = defineApi({
      tag: 'bad',
      prefix: '/bad',
      realm: 'open',
      endpoints: {
        a: defineEndpoint({
          method: 'get',
          path: '/a',
          summary: 'x',
          response: { kind: 'data', status: 200, schema: twin({ a: z.string() }) },
        }),
        b: defineEndpoint({
          method: 'get',
          path: '/b',
          summary: 'x',
          response: { kind: 'data', status: 200, schema: twin({ b: z.string() }) },
        }),
      },
    });
    expect(() => buildOpenApi([bad])).toThrow(/"Twin" names two different schemas/);
  });

  it('refuses the same method and path declared twice', () => {
    expect(() => buildOpenApi([sample, sample])).toThrow(/is declared twice/);
  });
});
