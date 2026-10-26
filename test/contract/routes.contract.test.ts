import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging/logger.js";
import { testApp } from "../helpers/app.js";
import { connectToTestDb } from "../helpers/db.js";
import { apiDocs, tableRows } from "./markdown-tables.js";

interface LayerType {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: LayerType[] };
}
interface RouterType {
  stack: LayerType[];
  use: (...args: unknown[]) => unknown;
}

/**
 * Express 5 keeps no mount prefix as a string: a layer holds only a compiled matcher. While the app is built, this
 * wraps `Router.prototype.use` to remember the path each layer was mounted at, so the stack can be walked afterwards.
 */
function routesOfApp(build: () => express.Express): string[] {
  const proto = express.Router.prototype as unknown as RouterType;
  const original = proto.use;
  const prefixOf = new WeakMap<LayerType, string>();
  proto.use = function use(this: RouterType, ...args: unknown[]) {
    const before = this.stack.length;
    const result = original.apply(this, args);
    const path = args[0];
    if (Array.isArray(path)) {
      throw new Error("an array mount path cannot be listed by the contract test");
    }
    for (const layer of this.stack.slice(before)) {
      prefixOf.set(layer, typeof path === "string" ? path : "/");
    }
    return result;
  };
  let app: express.Express;
  try {
    app = build();
  } finally {
    proto.use = original;
  }

  const joinPaths = (base: string, path: string) =>
    `${base}/${path}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  const walk = (stack: LayerType[], base: string): string[] =>
    stack.flatMap((layer) => {
      if (layer.route) {
        const full = joinPaths(base, layer.route.path);
        return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${full}`);
      }
      return layer.handle?.stack
        ? walk(layer.handle.stack, joinPaths(base, prefixOf.get(layer) ?? "/"))
        : [];
    });
  return walk((app as unknown as { router: RouterType }).router.stack, "/");
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Path parameter names are free (`:id` is `:requestId`), so every parameter compares as `:param`. */
const normalize = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, ":param");

function routesOfDocs(): { routes: string[]; malformed: string[] } {
  const routes: string[] = [];
  const malformed: string[] = [];
  for (const { path: file, text } of apiDocs()) {
    for (const [method = "", pathCell = ""] of tableRows(text)) {
      if (!METHODS.some((name) => method.startsWith(name))) {
        continue;
      }
      const path = /^`(\/[^`]*)`$/.exec(pathCell)?.[1];
      if (!METHODS.includes(method) || path === undefined || path.includes("?")) {
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

describe("routes and the .API.md tables (C5)", () => {
  const mounted = () => [
    ...new Set(
      routesOfApp(() => testApp(pool, createLogger("silent"))).map((route) => {
        const [method = "", path = ""] = route.split(" ");
        return `${method} ${normalize(path)}`;
      }),
    ),
  ];

  it("lists the routes of the real app", () => {
    // A sanity check of the listing itself, so an empty or wrong walk cannot pass the comparison below.
    const routes = mounted();
    expect(routes).toContain("GET /health");
    expect(routes).toContain("POST /requests/:param/accept");
    expect(routes).toContain("PUT /calendar/hours/:param");
    expect(routes.length).toBeGreaterThan(80);
  });

  it("has a table row for every mounted route", () => {
    const documented = new Set(routesOfDocs().routes);
    const missing = mounted().filter((route) => !documented.has(route));
    expect(missing).toEqual([]);
  });

  it("has a mounted route for every table row", () => {
    const real = new Set(mounted());
    const unknown = routesOfDocs().routes.filter((route) => !real.has(route));
    expect(unknown).toEqual([]);
  });

  it("writes every row as a method and a full path without a query string", () => {
    expect(routesOfDocs().malformed).toEqual([]);
  });
});
