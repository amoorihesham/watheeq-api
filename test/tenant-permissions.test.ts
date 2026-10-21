import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { authenticate } from "../src/modules/auth/index.js";
import { signAccessToken } from "../src/modules/auth/shared/tokens.js";
import {
  requireTenantPermission,
  TENANT_PERMISSIONS,
  type TenantPermissionType,
  tenantPermissionsOf,
} from "../src/modules/tenant-access/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";
import { connectToTestDb, seedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const OMAR = "omar@tp-watheeq.test";
const SARA = "sara@tp-alnoor.test";
const KHALID = "khalid@tp-alnoor.test";

const pool = connectToTestDb();

// One test-only route per tenant permission, guarded the way Phase 2 tenant routes are.
const tenantRoutes = express.Router();
for (const permission of TENANT_PERMISSIONS) {
  tenantRoutes.get(
    `/needs/${permission}`,
    authenticate(TEST_JWT_SECRET),
    requireTenantPermission(permission),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
}
tenantRoutes.get(
  "/forced-false",
  authenticate(TEST_JWT_SECRET),
  requireTenantPermission("org.view", () => new Set()),
  (_req, res) => {
    res.json({ ok: true });
  },
);
const app = testApp(pool, createLogger("silent"), { routers: [tenantRoutes] });

let omar = "";
let sara = "";
let khalid = "";
let tenantId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await seedUser(pool, { email: OMAR, passwordHash, role: "operator" });
  tenantId = (
    await seedTenant(pool, "tp-al-noor", [
      { email: SARA, passwordHash },
      { email: KHALID, passwordHash },
    ])
  ).id;
  omar = (await login(app, OMAR, PASSWORD)).access;
  sara = (await login(app, SARA, PASSWORD)).access;
  khalid = (await login(app, KHALID, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

const statusFor = async (permission: string, access?: string) => {
  const req = request(app).get(`/needs/${permission}`);
  return (await (access ? req.set("Cookie", accessCookie(access)) : req)).status;
};

const MEMBER_PERMISSIONS: TenantPermissionType[] = ["org.view", "user.view"];

describe("requireTenantPermission with the interim role table (R2.20, P2.9)", () => {
  it.each(TENANT_PERMISSIONS)("lets an admin through %s", async (permission) => {
    expect(await statusFor(permission, sara)).toBe(200);
  });

  it.each(TENANT_PERMISSIONS)(
    "lets a member through %s only if it is a view permission",
    async (permission) => {
      expect(await statusFor(permission, khalid)).toBe(
        MEMBER_PERMISSIONS.includes(permission) ? 200 : 403,
      );
    },
  );

  it("refuses a member with 403 FORBIDDEN", async () => {
    const res = await request(app).get("/needs/user.create").set("Cookie", accessCookie(khalid));
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it.each(TENANT_PERMISSIONS)("refuses an operator on %s", async (permission) => {
    expect(await statusFor(permission, omar)).toBe(403);
  });

  it("returns 401 without a session", async () => {
    expect(await statusFor("org.view")).toBe(401);
  });

  it("returns 403 when the permission check says no, even for an admin", async () => {
    expect((await request(app).get("/forced-false").set("Cookie", accessCookie(sara))).status).toBe(
      403,
    );
  });
});

describe("tokens that carry a Phase 3 role", () => {
  const tokenWith = (roleName: string, permissions: string[]) =>
    signAccessToken(
      {
        id: randomUUID(),
        email: "role@tp-alnoor.test",
        userName: "Role",
        role: "user",
        tenant: { id: tenantId, roleId: randomUUID(), roleName, permissions },
      },
      TEST_JWT_SECRET,
      60,
    );

  it("uses the token's permissions instead of the fallback", async () => {
    const token = await tokenWith("Legal Staff", ["user.create"]);
    expect(await statusFor("user.create", token)).toBe(200);
    expect(await statusFor("org.view", token)).toBe(403);
  });

  it("does not fall back by name: a role named admin holds only what its token lists", async () => {
    const token = await tokenWith("admin", []);
    expect(await statusFor("org.view", token)).toBe(403);
  });
});

describe("tenantPermissionsOf", () => {
  const base = { id: "x", email: "x@y.z", userName: "X", role: "user" as const };
  const tenant = { id: "t", roleId: null, permissions: [] };

  it("gives an operator none", () => {
    expect(tenantPermissionsOf({ ...base, role: "operator", tenant: null }).size).toBe(0);
  });

  it("gives an unknown interim role name none", () => {
    expect(tenantPermissionsOf({ ...base, tenant: { ...tenant, roleName: "owner" } }).size).toBe(0);
  });

  it("never lists a platform permission", () => {
    for (const permission of TENANT_PERMISSIONS) {
      expect(permission).not.toMatch(/^platform\./);
    }
  });
});
