import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "../src/http/validate.js";
import { testApp } from "./helpers/app.js";
import { connectToTestDb } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

const capture = captureLogs();
const pool = connectToTestDb(capture.logger);

// Test-only routes; production code ships no debug routes.
const testRouter = express.Router();
testRouter.post("/echo", (req, res) => {
  res.json({ received: req.body ?? null });
});
testRouter.post("/validated", (req, res) => {
  const body = validate(z.object({ email: z.email(), age: z.number() }), req.body);
  res.json(body);
});
testRouter.get("/boom", () => {
  throw new TypeError("secret internal detail");
});
testRouter.post("/duplicate-email", async (_req, res) => {
  const insert =
    "insert into users (email, user_name, password_hash) values ('dup@alnoor.test', 'Dup', 'x') on conflict do nothing";
  await pool.query(insert);
  await pool.query(
    "insert into users (email, user_name, password_hash) values ('dup@alnoor.test', 'Dup', 'x')",
  );
  res.json({});
});
testRouter.post("/duplicate-slug", async (_req, res) => {
  await pool.query("insert into tenants (name, slug) values ('A', 'dup') on conflict do nothing");
  await pool.query("insert into tenants (name, slug) values ('B', 'dup')");
  res.json({});
});
testRouter.get("/async-boom", async () => {
  await Promise.resolve();
  throw new Error("async secret detail");
});

const app = testApp(pool, capture.logger, { routers: [testRouter] });

afterAll(async () => {
  await pool.end();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("standard error shape", () => {
  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", requestId: res.headers["x-request-id"] },
    });
  });

  it("returns 400 VALIDATION_FAILED for malformed JSON", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_FAILED", requestId: res.headers["x-request-id"] },
    });
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over 100 KB", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(101 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", requestId: res.headers["x-request-id"] },
    });
  });

  it("accepts a body just under the limit", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(90 * 1024) }));
    expect(res.status).toBe(200);
  });

  it("returns 415 UNSUPPORTED_MEDIA_TYPE for a body without a JSON content type", async () => {
    const res = await request(app).post("/echo").set("Content-Type", "text/plain").send("hello");
    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: { code: "UNSUPPORTED_MEDIA_TYPE", requestId: res.headers["x-request-id"] },
    });
  });

  it("returns 415 for a form-encoded body", async () => {
    const res = await request(app).post("/echo").type("form").send({ a: "1" });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("allows a POST with no body and no content type", async () => {
    const res = await request(app).post("/echo");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: null });
  });

  it("returns 400 with {path, code} details for a validation failure", async () => {
    const res = await request(app).post("/validated").send({ email: "not-an-email", age: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.error.details).toEqual([
      { path: "email", code: "invalid_format" },
      { path: "age", code: "invalid_type" },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("message");
  });

  it("returns 500 INTERNAL with no internals in the body, and logs the stack", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL", requestId: res.headers["x-request-id"] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|TypeError|at /);

    const logged = capture
      .lines()
      .find((line) => line.reqId === res.headers["x-request-id"] && line.err);
    const err = logged?.err as { stack?: string } | undefined;
    expect(err?.stack).toContain("secret internal detail");
  });

  it("translates a mapped unique violation centrally (users_email_unique to 409 EMAIL_TAKEN)", async () => {
    const res = await request(app).post("/duplicate-email");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: "EMAIL_TAKEN", requestId: res.headers["x-request-id"] },
    });
  });

  it("returns 500 INTERNAL for a unique violation that has no mapping", async () => {
    const res = await request(app).post("/duplicate-slug");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });

  it("handles errors thrown from async handlers", async () => {
    const res = await request(app).get("/async-boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });

  it("does not turn health into an error", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

describe("request IDs", () => {
  it("generates a UUID when none is sent", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("echoes a valid incoming ID", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "client-abc_1.2");
    expect(res.headers["x-request-id"]).toBe("client-abc_1.2");
  });

  it.each([
    ["markup", "<script>alert(1)</script>"],
    ["too long", "a".repeat(65)],
    ["spaces", "has space"],
  ])("replaces an invalid incoming ID (%s)", async (_label, bad) => {
    const res = await request(app).get("/health").set("X-Request-Id", bad);
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("includes the request ID in error bodies", async () => {
    const res = await request(app).get("/nope").set("X-Request-Id", "trace-42");
    expect(res.body.error.requestId).toBe("trace-42");
  });
});

describe("request logging", () => {
  it("puts the request ID on every log line of a request, matching the response header", async () => {
    const res = await request(app).get("/boom").set("X-Request-Id", "log-check-1");
    expect(res.headers["x-request-id"]).toBe("log-check-1");
    const lines = capture.lines().filter((line) => line.reqId === "log-check-1");
    expect(lines.length).toBeGreaterThan(0);
    const mine = capture.lines().filter((line) => JSON.stringify(line).includes("log-check-1"));
    expect(mine.every((line) => line.reqId === "log-check-1")).toBe(true);
  });

  it("redacts sensitive headers and fields", async () => {
    await request(app)
      .get("/health")
      .set("X-Request-Id", "redact-1")
      .set("Cookie", "sid=supersecretcookie")
      .set("Authorization", "Bearer supersecrettoken")
      .set("X-CSRF-Token", "supersecretcsrf");
    const text = JSON.stringify(capture.lines().filter((line) => line.reqId === "redact-1"));
    expect(text).toContain("[Redacted]");
    for (const secret of ["supersecretcookie", "supersecrettoken", "supersecretcsrf"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("redacts password fields in logged objects", () => {
    const local = captureLogs();
    local.logger.info(
      { password: "hunter2", user: { password: "hunter3", email: "a@b.sa" } },
      "login attempt",
    );
    const [line] = local.lines();
    expect(line).toMatchObject({
      password: "[Redacted]",
      user: { password: "[Redacted]", email: "a@b.sa" },
    });
    expect(JSON.stringify(line)).not.toMatch(/hunter/);
  });

  it("redacts set-cookie on responses", async () => {
    const local = captureLogs();
    const cookieRouter = express.Router();
    cookieRouter.get("/cookie", (_req, res) => {
      res.setHeader("Set-Cookie", "sid=supersecretsession; HttpOnly");
      res.json({});
    });
    await request(testApp(pool, local.logger, { routers: [cookieRouter] })).get("/cookie");
    const text = JSON.stringify(local.lines());
    expect(text).toContain("[Redacted]");
    expect(text).not.toContain("supersecretsession");
  });
});
