import request from "supertest";
import { afterAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";

describe("GET /health", () => {
  const upPool = createPool(inject("databaseUrl"));
  // Port 1 is reserved and nothing listens on it, so connections are refused.
  const downPool = createPool("postgres://watheeq:watheeq@127.0.0.1:1/watheeq");

  afterAll(async () => {
    await Promise.all([upPool.end(), downPool.end()]);
  });

  it("returns 200 with db up when PostgreSQL is reachable", async () => {
    const res = await request(buildApp({ pool: upPool })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "up" });
  });

  it("returns 503 with db down, within the timeout, when PostgreSQL is unreachable", async () => {
    const started = Date.now();
    const res = await request(buildApp({ pool: downPool })).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", db: "down" });
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
