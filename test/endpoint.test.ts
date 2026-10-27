import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildRouter,
  defineApi,
  defineEndpoint,
  type HandlerOf,
  type HandlersOf,
} from "../src/http/endpoint.js";
import { idFilter } from "../src/http/filters.js";
import { idSchema } from "../src/http/validate.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { jsonBody } from "../src/middleware/json-body.js";
import { signAccessToken } from "../src/modules/auth/shared/tokens.js";
import { accessCookie } from "./helpers/auth.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";

const itemParams = z.strictObject({ itemId: idSchema });
const itemSchema = z.strictObject({ id: z.string(), limit: z.number(), owner: z.string() });
const createBody = z.strictObject({ name: z.string().min(1), kind: z.enum(["a", "b"]) });

const api = defineApi({
  tag: "test",
  prefix: "/t",
  realm: "open",
  endpoints: {
    getItem: defineEndpoint({
      method: "get",
      path: "/items/:itemId",
      summary: "One item",
      params: itemParams,
      query: z.strictObject({
        limit: z.coerce.number().int().default(10),
        owner: idFilter({ none: true }),
      }),
      response: { kind: "data", status: 200, schema: itemSchema },
    }),
    create: defineEndpoint({
      method: "post",
      path: "/items",
      summary: "Create an item",
      body: createBody,
      response: { kind: "data", status: 201, schema: z.strictObject({ name: z.string() }) },
    }),
    guarded: defineEndpoint({
      method: "post",
      path: "/guarded/:itemId",
      realm: "session",
      summary: "Needs a permission",
      permission: { tenant: "request.review" },
      params: itemParams,
      body: createBody,
      response: { kind: "noContent" },
    }),
    broken: defineEndpoint({
      method: "get",
      path: "/broken",
      summary: "Answers a value that is not its schema",
      response: { kind: "data", status: 200, schema: z.strictObject({ n: z.number() }) },
    }),
  },
});

const seen: { params?: unknown; query?: unknown; body?: unknown }[] = [];

const handlers = {
  getItem: (async (input) => {
    seen.push(input);
    return { id: input.params.itemId, limit: input.query.limit, owner: input.query.owner };
  }) satisfies HandlerOf<typeof api.endpoints.getItem>,
  create: (async ({ body }) => {
    seen.push({ body });
    return { name: body.name };
  }) satisfies HandlerOf<typeof api.endpoints.create>,
  guarded: (async (input) => {
    seen.push(input);
  }) satisfies HandlerOf<typeof api.endpoints.guarded>,
  broken: (async () => ({ n: "not a number" })) as unknown as HandlerOf<
    typeof api.endpoints.broken
  >,
} satisfies HandlersOf<typeof api>;

function appOf(): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(jsonBody());
  app.use(api.prefix, buildRouter(api, handlers, { db: {} as never, jwtSecret: TEST_JWT_SECRET }));
  app.use(errorHandler);
  return app;
}

const app = appOf();
const ID = "0b9e8a5e-6d3c-4a35-9e4b-2f1f7b1c2d3e";

const tokenFor = (permissions: string[]) =>
  signAccessToken(
    {
      id: ID,
      email: "huda@alnoor.test",
      userName: "Huda",
      role: "user",
      tenant: { id: ID, roleId: ID, roleName: "Reviewer", permissions },
    },
    TEST_JWT_SECRET,
    60,
  );

describe("buildRouter input (R10.3, R10.4)", () => {
  it("answers 404 NOT_FOUND for a path parameter that is not a UUID", async () => {
    const res = await request(app).get("/t/items/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("answers 400 VALIDATION_FAILED for a body, with details at the field's own path", async () => {
    const res = await request(app).post("/t/items").send({ name: "", kind: "c", extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: "name", code: "too_small" },
        { path: "kind", code: "invalid_value" },
        { path: "extra", code: "unknown_field" },
      ]),
    );
  });

  it("answers 400 for a query, with details at the field's own path", async () => {
    const res = await request(app).get(`/t/items/${ID}?owner=somebody`);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "owner", code: "invalid_value" }]);
  });

  it("checks the path before the body: a bad ID and a bad body is 404", async () => {
    const res = await request(app)
      .post("/t/guarded/nope")
      .set("Cookie", accessCookie(await tokenFor(["request.review"])))
      .send({});
    expect(res.status).toBe(404);
  });

  it("gives the handler lower-cased IDs and query defaults", async () => {
    seen.length = 0;
    const res = await request(app).get(`/t/items/${ID.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: ID, limit: 10, owner: "all" } });
    expect(seen[0]).toEqual({ params: { itemId: ID }, query: { limit: 10, owner: "all" } });
  });

  it("sends the declared status and wraps the value in data", async () => {
    const res = await request(app).post("/t/items").send({ name: "Contract", kind: "a" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: "Contract" } });
  });

  it("sends 204 with no body for noContent", async () => {
    const res = await request(app)
      .post(`/t/guarded/${ID}`)
      .set("Cookie", accessCookie(await tokenFor(["request.review"])))
      .send({ name: "x", kind: "b" });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });
});

describe("buildRouter guards (R10.5)", () => {
  it("answers 401 before anything else without the access cookie", async () => {
    const res = await request(app).post(`/t/guarded/${ID}`).send({});
    expect(res.status).toBe(401);
  });

  it("runs the permission before validation: no permission and a bad body is 403", async () => {
    const res = await request(app)
      .post(`/t/guarded/${ID}`)
      .set("Cookie", accessCookie(await tokenFor([])))
      .send({ nonsense: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("applies the realm's no-store header only where the realm has it", async () => {
    const open = await request(app).get(`/t/items/${ID}`);
    expect(open.headers["cache-control"]).toBeUndefined();
    const session = await request(app).post(`/t/guarded/${ID}`).send({});
    expect(session.headers["cache-control"]).toBe("no-store");
  });
});

describe("buildRouter responses (R10.6)", () => {
  it("fails the response check, outside production, when the value does not match its schema", async () => {
    const res = await request(app).get("/t/broken");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });
});

describe("buildRouter declarations", () => {
  const build = (endpoint: ReturnType<typeof defineEndpoint>) =>
    buildRouter(
      defineApi({ tag: "bad", prefix: "/bad", realm: "open", endpoints: { one: endpoint } }),
      { one: async () => undefined } as never,
    );

  it("throws when params keys differ from the path's names", () => {
    expect(() =>
      build(
        defineEndpoint({
          method: "get",
          path: "/:itemId",
          summary: "x",
          params: z.strictObject({ id: idSchema }),
          response: { kind: "noContent" },
        }),
      ),
    ).toThrow(/bad.one: params \[id\] do not match the path \/:itemId/);
  });

  it("throws when a path has parameters and no params schema", () => {
    expect(() =>
      build(
        defineEndpoint({
          method: "get",
          path: "/:itemId",
          summary: "x",
          response: { kind: "noContent" },
        }),
      ),
    ).toThrow(/do not match the path/);
  });

  it("throws when a handler is missing", () => {
    expect(() =>
      buildRouter(
        defineApi({
          tag: "bad",
          prefix: "/bad",
          realm: "open",
          endpoints: {
            one: defineEndpoint({
              method: "get",
              path: "/",
              summary: "x",
              response: { kind: "noContent" },
            }),
          },
        }),
        {} as never,
      ),
    ).toThrow(/bad.one has no handler/);
  });

  it("throws when an endpoint's realm does not extend its group's", () => {
    expect(() =>
      build(
        defineEndpoint({
          method: "get",
          path: "/",
          summary: "x",
          realm: "public",
          response: { kind: "noContent" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      buildRouter(
        defineApi({
          tag: "bad",
          prefix: "/bad",
          realm: "operator",
          endpoints: {
            one: defineEndpoint({
              method: "get",
              path: "/",
              summary: "x",
              realm: "tenant",
              response: { kind: "noContent" },
            }),
          },
        }),
        { one: async () => undefined } as never,
        { db: {} as never, jwtSecret: TEST_JWT_SECRET },
      ),
    ).toThrow(/must extend the realm of its group/);
  });
});
