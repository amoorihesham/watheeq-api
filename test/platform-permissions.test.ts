import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { authenticate, requireRole } from "../src/modules/auth/index.js";
import {
  PLATFORM_PERMISSIONS,
  platformPermissionsOf,
  requirePlatformPermission,
} from "../src/modules/platform/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";
import { connectToTestDb, seedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const OMAR = "omar@perm-watheeq.test";
const SARA = "sara@perm-alnoor.test";

const pool = connectToTestDb();

// Test-only routes, guarded the way Phase 1 operator routes are.
const operatorRoutes = express.Router();
const ok: express.RequestHandler = (_req, res) => {
  res.json({ ok: true });
};
operatorRoutes.get(
  "/plans-like",
  authenticate(TEST_JWT_SECRET),
  requireRole("operator"),
  requirePlatformPermission("platform.plan.view"),
  ok,
);
// Without requireRole, to show the permission check alone refuses a tenant user.
operatorRoutes.get(
  "/permission-only",
  authenticate(TEST_JWT_SECRET),
  requirePlatformPermission("platform.tenant.view"),
  ok,
);
operatorRoutes.get(
  "/forced-false",
  authenticate(TEST_JWT_SECRET),
  requireRole("operator"),
  requirePlatformPermission("platform.plan.create", () => new Set()),
  ok,
);
const app = testApp(pool, createLogger("silent"), { routers: [operatorRoutes] });

let omarAccess = "";
let saraAccess = "";

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await seedUser(pool, { email: OMAR, passwordHash, role: "operator" });
  await seedTenant(pool, "perm-al-noor", [{ email: SARA, passwordHash }]);
  omarAccess = (await login(app, OMAR, PASSWORD)).access;
  saraAccess = (await login(app, SARA, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

const get = (path: string, access?: string) => {
  const req = request(app).get(path);
  return access ? req.set("Cookie", accessCookie(access)) : req;
};

describe("requirePlatformPermission (R1.16)", () => {
  it("lets an operator through a route that declares a platform permission", async () => {
    expect((await get("/plans-like", omarAccess)).status).toBe(200);
  });

  it("refuses a tenant user with 403 FORBIDDEN", async () => {
    const res = await get("/plans-like", saraAccess);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses a tenant user on its own, even without requireRole", async () => {
    expect((await get("/permission-only", omarAccess)).status).toBe(200);
    const res = await get("/permission-only", saraAccess);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the permission check says no, even for an operator", async () => {
    const res = await get("/forced-false", omarAccess);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 without a session", async () => {
    expect((await get("/plans-like")).status).toBe(401);
  });
});

describe("platformPermissionsOf", () => {
  const user = { id: "x", email: "x@y.z", userName: "X", tenant: null };

  it("gives every operator every platform permission (MVP)", () => {
    expect([...platformPermissionsOf({ ...user, role: "operator" })].sort()).toEqual(
      [...PLATFORM_PERMISSIONS].sort(),
    );
  });

  it("gives a tenant user none", () => {
    expect(platformPermissionsOf({ ...user, role: "user" }).size).toBe(0);
  });

  it("keeps every platform permission under the platform. prefix", () => {
    for (const permission of PLATFORM_PERMISSIONS) {
      expect(permission).toMatch(/^platform\./);
    }
  });
});
