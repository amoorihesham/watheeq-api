import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { validate } from "@scalar/openapi-parser";
import { afterAll, describe, expect, it } from "vitest";
import { apis } from "../../src/http/apis.js";
import { fullPathOf } from "../../src/http/endpoint.js";
import { buildOpenApi } from "../../src/http/openapi.js";
import { createLogger } from "../../src/logging/logger.js";
import { testApp } from "../helpers/app.js";
import { connectToTestDb } from "../helpers/db.js";
import { normalize, routesOfApp } from "./route-walker.js";
import { moduleFiles } from "./source-files.js";

const OPENAPI_FILE = "docs/api/openapi.json";

const pool = connectToTestDb();
afterAll(() => pool.end());

describe("the OpenAPI document (R10.7)", () => {
  const fresh = `${JSON.stringify(buildOpenApi(apis), null, 2)}\n`;

  it("is the committed file: run `pnpm openapi` after changing a declaration or schema", () => {
    expect(readFileSync(OPENAPI_FILE, "utf8"), `${OPENAPI_FILE} is stale`).toBe(fresh);
  });

  it("is a valid OpenAPI 3.1 document", async () => {
    const result = await validate(JSON.parse(fresh));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.version).toBe("3.1");
  });

  it("names its components once, by their schema ids", () => {
    // Two schemas sharing an id, or one id with two shapes, already fail the build above; this guards the ids' form.
    const ids = Object.keys(JSON.parse(fresh).components.schemas as Record<string, unknown>);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !/^[A-Z][A-Za-z0-9]*$/.test(id))).toEqual([]);
  });
});

describe("routes and declarations (R10.1, R10.2)", () => {
  // Step 10.4 declares every group; until then only the declared groups are compared.
  const scopes = apis.flatMap((api) =>
    api.prefix === "/"
      ? Object.values(api.endpoints).map((endpoint) => normalize(fullPathOf(api, endpoint)))
      : [normalize(api.prefix)],
  );
  const inScope = (route: string) => {
    const path = route.split(" ")[1] ?? "";
    return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
  };

  const declared = apis
    .flatMap((api) =>
      Object.values(api.endpoints).map(
        (endpoint) => `${endpoint.method.toUpperCase()} ${normalize(fullPathOf(api, endpoint))}`,
      ),
    )
    .sort();
  const mounted = [
    ...new Set(
      routesOfApp(() => testApp(pool, createLogger("silent")))
        .map((route) => {
          const [method = "", path = ""] = route.split(" ");
          return `${method} ${normalize(path)}`;
        })
        .filter(inScope),
    ),
  ].sort();

  it("mounts exactly the declared endpoints of the declared groups", () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(mounted).toEqual(declared);
  });

  it("has no routes file that mounts a route by hand", () => {
    const dirs = new Set(moduleFiles(".endpoints.ts").map((file) => dirname(file.path)));
    const direct = /\brouter\s*\.\s*(get|post|put|patch|delete)\s*\(/;
    const offences = moduleFiles(".routes.ts")
      .filter((file) => dirs.has(dirname(file.path)) && direct.test(file.text))
      .map((file) => file.path);
    expect(offences).toEqual([]);
  });
});
