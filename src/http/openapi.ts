import { z } from 'zod';
import { ACCESS_COOKIE } from '@/modules/auth/auth.constants.js';
import { type ApiType, type EndpointType, fullPathOf, isAuthenticatedRealm, isBinaryBody, type MethodType, pathParamNames, realmOf } from './endpoint.js';
import { DETAIL_CODES, type ErrorCode, STATUS_BY_CODE } from './errors.js';

type JsonType = Record<string, unknown>;

const ERROR_CODES = Object.keys(STATUS_BY_CODE) as [ErrorCode, ...ErrorCode[]];
const METHOD_ORDER: readonly MethodType[] = ['get', 'post', 'put', 'patch', 'delete'];
const SCHEMAS = '#/components/schemas/';

// The wrappers every operation shares (Phase 10 spec 4.5); named like any other component.
const errorDetailSchema = z.strictObject({ path: z.string(), code: z.enum(DETAIL_CODES) }).meta({ id: 'ErrorDetail' });

const errorSchema = z
  .strictObject({
    error: z.strictObject({
      code: z.enum(ERROR_CODES),
      requestId: z.string(),
      details: z.array(errorDetailSchema),
    }),
  })
  .meta({ id: 'Error' });

const pageSchema = z.strictObject({ nextCursor: z.string().nullable(), total: z.number() }).meta({ id: 'Page' });

// Types `toJSONSchema` cannot describe; with `unrepresentable: "any"` they would silently become `{}`.
const UNREPRESENTABLE = new Set(['bigint', 'symbol', 'undefined', 'void', 'map', 'set', 'file', 'custom', 'function', 'nan', 'promise']);

const INFO_DESCRIPTION = `The Watheeq legal affairs API.

Success, list, and error shapes, authentication, and access are described once in the API guide in the backend repository (\`docs/api/\`), not per operation:

- \`conventions.md\`: response and list shapes, cursors, filters, and the Read-only state.
- \`errors.md\`: every error code and detail code.
- \`auth.md\`: the access and refresh cookies.
- \`access.md\`: who can call what.`;

/** Turns every `$ref` into a component reference; `toJSONSchema` writes definitions under `$defs`. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(rewriteRefs);
  }
  if (typeof node === 'object' && node !== null) {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === '$ref' && typeof value === 'string' ? value.replace('#/$defs/', SCHEMAS) : rewriteRefs(value)]));
  }
  return node;
}

/** Converts schemas one by one and gathers the components (every schema with an `id`) they define. */
function createConverter() {
  const components = new Map<string, JsonType>();
  const owners = new Map<string, object>();

  function convert(schema: z.ZodType, io: 'input' | 'output', where: string): JsonType {
    const problems: string[] = [];
    const json = z.toJSONSchema(schema, {
      io,
      unrepresentable: 'any',
      override: ({ zodSchema, jsonSchema, path }) => {
        const id = z.globalRegistry.get(zodSchema)?.id;
        if (id) {
          const owner = owners.get(id);
          if (owner && owner !== zodSchema) {
            throw new Error(`${where}: the component id "${id}" names two different schemas`);
          }
          owners.set(id, zodSchema);
        }
        const type = zodSchema._zod.def.type;
        if (type === 'date') {
          // JSON carries a Date as an ISO string.
          Object.assign(jsonSchema, { type: 'string', format: 'date-time' });
        } else if (UNREPRESENTABLE.has(type)) {
          problems.push(`${type} at ${path.join('.') || '(root)'}`);
        }
      },
    }) as JsonType;
    if (problems.length > 0) {
      throw new Error(`${where} cannot be described: ${problems.join('; ')}`);
    }
    const { $schema: _schema, $defs: defs, ...root } = json;
    for (const [id, definition] of Object.entries((defs ?? {}) as Record<string, unknown>)) {
      const rewritten = rewriteRefs(definition) as JsonType;
      const known = components.get(id);
      if (known && JSON.stringify(known) !== JSON.stringify(rewritten)) {
        throw new Error(`${where}: the component "${id}" has two different shapes`);
      }
      components.set(id, rewritten);
    }
    return rewriteRefs(root) as JsonType;
  }

  /** The properties of an object schema, resolving a root that is itself a component. */
  function propertiesOf(schema: z.ZodType, where: string) {
    let json = convert(schema, 'input', where);
    if (typeof json.$ref === 'string') {
      json = components.get(json.$ref.slice(SCHEMAS.length)) ?? json;
    }
    if (json.type !== 'object' || typeof json.properties !== 'object') {
      throw new Error(`${where} must be an object schema`);
    }
    return {
      properties: json.properties as Record<string, JsonType>,
      required: new Set((json.required ?? []) as string[]),
    };
  }

  return { convert, propertiesOf, components };
}

const jsonContent = (schema: JsonType) => ({ 'application/json': { schema } });
const errorContent = jsonContent({ $ref: `${SCHEMAS}Error` });

/** The codes the declaration implies (spec 4.5), then its own, each once. */
function errorCodesOf(api: ApiType, endpoint: EndpointType): ErrorCode[] {
  const realm = realmOf(api, endpoint);
  const codes = new Set<ErrorCode>(['INTERNAL', ...(endpoint.errors ?? [])]);
  if (isAuthenticatedRealm(realm)) {
    codes.add('UNAUTHENTICATED');
  }
  if (realm === 'operator' || realm === 'tenant' || realm === 'tenantInbox' || endpoint.permission) {
    codes.add('FORBIDDEN');
  }
  if (realm === 'tenant' && endpoint.method !== 'get') {
    codes.add('SUBSCRIPTION_READ_ONLY');
  }
  if (endpoint.activeSubscription) {
    codes.add('SUBSCRIPTION_NOT_ACTIVE');
  }
  if (endpoint.params) {
    codes.add('NOT_FOUND');
  }
  if (endpoint.query || (endpoint.body && !isBinaryBody(endpoint.body))) {
    codes.add('VALIDATION_FAILED');
  }
  if (endpoint.body && !isBinaryBody(endpoint.body)) {
    codes.add('PAYLOAD_TOO_LARGE');
    codes.add('UNSUPPORTED_MEDIA_TYPE');
  }
  // A fixed order, so the document is the same on every build.
  return ERROR_CODES.filter((code) => codes.has(code));
}

function errorResponsesOf(codes: ErrorCode[]): Record<string, JsonType> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    byStatus.set(STATUS_BY_CODE[code], [...(byStatus.get(STATUS_BY_CODE[code]) ?? []), code]);
  }
  return Object.fromEntries([...byStatus.entries()].sort(([a], [b]) => a - b).map(([status, list]) => [String(status), { description: list.map((code) => `\`${code}\``).join(', '), content: errorContent }]));
}

type ConverterType = ReturnType<typeof createConverter>;

function successResponseOf(endpoint: EndpointType, converter: ConverterType, where: string) {
  const { response } = endpoint;
  switch (response.kind) {
    case 'data':
      return {
        [response.status]: {
          description: response.status === 201 ? 'Created' : 'OK',
          content: jsonContent({
            type: 'object',
            required: ['data'],
            properties: { data: converter.convert(response.schema, 'output', where) },
          }),
        },
      };
    case 'page':
      return {
        200: {
          description: 'OK',
          content: jsonContent({
            type: 'object',
            required: ['data', 'page'],
            properties: {
              data: {
                type: 'array',
                items: converter.convert(response.schema, 'output', where),
              },
              page: { $ref: `${SCHEMAS}Page` },
            },
          }),
        },
      };
    case 'noContent':
      return { 204: { description: 'No content' } };
    case 'download':
      return {
        200: {
          description: 'The file, served only as a download',
          headers: { 'Content-Disposition': { schema: { type: 'string' } } },
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
      };
  }
}

function operationOf(api: ApiType, name: string, endpoint: EndpointType, converter: ConverterType) {
  const where = `${api.tag}.${name}`;
  const parameters: JsonType[] = [];
  if (endpoint.params) {
    const { properties } = converter.propertiesOf(endpoint.params, `${where} params`);
    for (const paramName of pathParamNames(endpoint.path)) {
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        schema: properties[paramName] ?? {},
      });
    }
  }
  if (endpoint.query) {
    const { properties, required } = converter.propertiesOf(endpoint.query, `${where} query`);
    for (const [queryName, schema] of Object.entries(properties)) {
      parameters.push({ name: queryName, in: 'query', required: required.has(queryName), schema });
    }
  }

  let requestBody: JsonType | undefined;
  if (isBinaryBody(endpoint.body)) {
    requestBody = {
      required: true,
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
    };
  } else if (endpoint.body) {
    requestBody = {
      required: true,
      content: jsonContent(converter.convert(endpoint.body, 'input', `${where} body`)),
    };
  }

  const permission = endpoint.permission;
  const key = permission && ('tenant' in permission ? permission.tenant : permission.platform);
  return {
    tags: [api.tag],
    summary: endpoint.summary,
    ...(isAuthenticatedRealm(realmOf(api, endpoint)) ? { security: [{ cookieAuth: [] }] } : {}),
    ...(key ? { 'x-permission': key } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      ...successResponseOf(endpoint, converter, `${where} response`),
      ...errorResponsesOf(errorCodesOf(api, endpoint)),
    },
  };
}

/**
 * The OpenAPI 3.1 document of the declared endpoints (Phase 10 spec 4.5), built from the declarations alone.
 * Paths, methods, components, and codes come out in a fixed order, so the same input is the same bytes.
 */
export function buildOpenApi(apis: readonly ApiType[]): JsonType {
  const converter = createConverter();
  // The shared wrappers are components whether or not an operation reaches them first.
  converter.convert(errorSchema, 'output', 'the Error wrapper');
  converter.convert(pageSchema, 'output', 'the Page wrapper');

  const operations: { path: string; method: MethodType; operation: JsonType }[] = [];
  for (const api of apis) {
    for (const [name, endpoint] of Object.entries(api.endpoints)) {
      const path = fullPathOf(api, endpoint).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      if (operations.some((known) => known.path === path && known.method === endpoint.method)) {
        throw new Error(`${endpoint.method.toUpperCase()} ${path} is declared twice`);
      }
      operations.push({
        path,
        method: endpoint.method,
        operation: operationOf(api, name, endpoint, converter),
      });
    }
  }
  operations.sort((a, b) => a.path.localeCompare(b.path, 'en') || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
  const paths: Record<string, Record<string, JsonType>> = {};
  for (const { path, method, operation } of operations) {
    paths[path] = { ...paths[path], [method]: operation };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Watheeq API', version: '1.0.0', description: INFO_DESCRIPTION },
    tags: [...new Set(apis.map((api) => api.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: ACCESS_COOKIE } },
      schemas: Object.fromEntries([...converter.components.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))),
    },
  };
}
