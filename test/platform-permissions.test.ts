import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { auditContext } from "../src/audit/index.js";
import { requirePlatformPermission } from "../src/middleware/require-platform-permission.js";
import {
  PLATFORM_PERMISSIONS,
  type PlatformPermission,
  platformPermissionsOf,
} from "../src/modules/platform/permissions.js";
import { testApp } from "./helpers/app.js";
import { connectAsApp } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

const OMAR = { id: "00000000-0000-4000-8000-000000000001", email: "omar@watheeq.test" };
const SARA = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "sara@alnoor.test",
  tenantId: "00000000-0000-4000-8000-000000000003",
};

// Test-only routes. A stand-in for requireOperator / requireUser attaches the principal.
const asOperator: express.RequestHandler = (req, _res, next) => {
  req.operatorAuth = { sessionId: "s", operator: OMAR };
  next();
};
const asUser: express.RequestHandler = (req, _res, next) => {
  req.userAuth = { sessionId: "s", user: SARA };
  next();
};
const onlyView = () => new Set<PlatformPermission>(["platform.plan.view"]);

const router = express.Router();
router.get("/t/default", asOperator, requirePlatformPermission("platform.plan.create"), (_q, r) => {
  r.json({ ok: true });
});
router.get(
  "/t/denied",
  asOperator,
  requirePlatformPermission("platform.plan.create", onlyView),
  (_q, r) => {
    r.json({ ok: true });
  },
);
router.get(
  "/t/held",
  asOperator,
  requirePlatformPermission("platform.plan.view", onlyView),
  (_q, r) => {
    r.json({ ok: true });
  },
);
router.get("/t/anonymous", requirePlatformPermission("platform.plan.view"), (_q, r) => {
  r.json({ ok: true });
});
router.get("/t/ctx/operator", asOperator, (req, res) => {
  res.json(auditContext(req));
});
router.get("/t/ctx/user", asUser, (req, res) => {
  res.json(auditContext(req));
});
router.get("/t/ctx/anonymous", (req, res) => {
  res.json(auditContext(req));
});

const capture = captureLogs();
const pool = connectAsApp(capture.logger);
const app = testApp(pool, capture.logger, { routers: [router] });

afterAll(async () => {
  await pool.end();
});

describe("requirePlatformPermission", () => {
  it("lets every operator through in the MVP, since every operator holds every platform permission", async () => {
    expect([...platformPermissionsOf(OMAR)].sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
    const res = await request(app).get("/t/default");
    expect(res.status).toBe(200);
  });

  it("rejects with 403 FORBIDDEN when the operator lacks the permission", async () => {
    const res = await request(app).get("/t/denied").set("X-Request-Id", "req-forbidden");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN", requestId: "req-forbidden" } });
  });

  it("lets the operator through when the permission is held", async () => {
    expect((await request(app).get("/t/held")).status).toBe(200);
  });

  it("rejects with 401 when no operator is authenticated", async () => {
    const res = await request(app).get("/t/anonymous");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("auditContext", () => {
  it("names the operator and the request", async () => {
    const res = await request(app).get("/t/ctx/operator").set("X-Request-Id", "req-ctx-op");
    expect(res.body).toEqual({ actor: { type: "operator", id: OMAR.id }, requestId: "req-ctx-op" });
  });

  it("names the tenant user and the request", async () => {
    const res = await request(app).get("/t/ctx/user").set("X-Request-Id", "req-ctx-user");
    expect(res.body).toEqual({ actor: { type: "user", id: SARA.id }, requestId: "req-ctx-user" });
  });

  it("rejects an unauthenticated request", async () => {
    expect((await request(app).get("/t/ctx/anonymous")).status).toBe(401);
  });
});
