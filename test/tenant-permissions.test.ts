import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { authenticate } from "../src/modules/auth/index.js";
import { signAccessToken } from "../src/modules/auth/shared/tokens.js";
import {
  grantedPermissions,
  PERMISSION_CATALOG,
  requireTenantPermission,
  systemRoleGrants,
  TENANT_PERMISSIONS,
  type TenantPermissionType,
  tenantPermissionsOf,
} from "../src/modules/tenant-access/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";
import { connectToTestDb, seedRole, seedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const OMAR = "omar@tp-watheeq.test";
const SARA = "sara@tp-alnoor.test";
const KHALID = "khalid@tp-alnoor.test";
const NORA = "nora@tp-alnoor.test";

const pool = connectToTestDb();

// One test-only route per tenant permission, guarded the way tenant routes are.
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
let nora = "";
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
  // A custom role with one write permission and no view permission, unlike anything Phase 2 had.
  const clerk = await seedRole(pool, tenantId, {
    name: "Invitations Clerk",
    permissions: [
      { key: "user.create", scope: "organization" },
      // Ignored: no longer in the catalog (P3.1).
      { key: "retired.permission", scope: "organization" },
    ],
  });
  const noraId = await seedUser(pool, { email: NORA, passwordHash });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    tenantId,
    noraId,
    clerk,
  ]);
  omar = (await login(app, OMAR, PASSWORD)).access;
  sara = (await login(app, SARA, PASSWORD)).access;
  khalid = (await login(app, KHALID, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

const statusFor = async (permission: string, access?: string) => {
  const req = request(app).get(`/needs/${permission}`);
  return (await (access ? req.set("Cookie", accessCookie(access)) : req)).status;
};

const MEMBER_PERMISSIONS: TenantPermissionType[] = ["org.view", "user.view"];

describe("requireTenantPermission with roles from the database (R2.20, R3.13)", () => {
  it.each(TENANT_PERMISSIONS)("lets the Tenant Admin through %s", async (permission) => {
    expect(await statusFor(permission, sara)).toBe(200);
  });

  it.each(TENANT_PERMISSIONS)(
    "lets a Member through %s only if their role grants it",
    async (permission) => {
      expect(await statusFor(permission, khalid)).toBe(
        MEMBER_PERMISSIONS.includes(permission) ? 200 : 403,
      );
    },
  );

  it.each(TENANT_PERMISSIONS)(
    "lets a custom role through %s only if it grants it",
    async (permission) => {
      expect(await statusFor(permission, nora)).toBe(permission === "user.create" ? 200 : 403);
    },
  );

  it("refuses with 403 FORBIDDEN", async () => {
    const res = await request(app).get("/needs/user.create").set("Cookie", accessCookie(khalid));
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it.each(TENANT_PERMISSIONS)("refuses an operator on %s", async (permission) => {
    expect(await statusFor(permission, omar)).toBe(403);
  });

  it("returns 401 without a session", async () => {
    expect(await statusFor("org.view")).toBe(401);
  });

  it("returns 403 when the permission check says no, even for the Tenant Admin", async () => {
    expect((await request(app).get("/forced-false").set("Cookie", accessCookie(sara))).status).toBe(
      403,
    );
  });

  it("judges a token by its permissions only, never by its role name", async () => {
    const token = await signAccessToken(
      {
        id: randomUUID(),
        email: "role@tp-alnoor.test",
        userName: "Role",
        role: "user",
        tenant: { id: tenantId, roleId: randomUUID(), roleName: "Tenant Admin", permissions: [] },
      },
      TEST_JWT_SECRET,
      60,
    );
    expect(await statusFor("org.view", token)).toBe(403);
  });
});

describe("grantedPermissions (R3.2, P3.8)", () => {
  it("gives the system role the whole catalog, whatever is stored", () => {
    expect(grantedPermissions({ isSystem: true, permissions: [] })).toEqual(TENANT_PERMISSIONS);
  });

  it("gives a custom role its stored keys in catalog order, ignoring keys not in the catalog", () => {
    expect(
      grantedPermissions({
        isSystem: false,
        permissions: ["role.view", "gone.away", "org.view"],
      }),
    ).toEqual(["org.view", "role.view"]);
  });

  it("describes the system role as every permission at its widest scope", () => {
    const grants = systemRoleGrants();
    expect(grants.map((grant) => grant.key)).toEqual(TENANT_PERMISSIONS);
    expect(grants.find((grant) => grant.key === "user.view")?.scope).toBe("organization");
    expect(grants.every((grant) => grant.scope === "organization")).toBe(true);
  });
});

describe("the permission catalog (R3.1)", () => {
  it("lists scopes from narrowest to widest, each one known", () => {
    const order = ["own", "section", "department", "organization"];
    for (const scopes of Object.values(PERMISSION_CATALOG)) {
      const ranks = scopes.map((scope) => order.indexOf(scope));
      expect(ranks.every((rank) => rank >= 0)).toBe(true);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("never lists a platform permission", () => {
    for (const permission of TENANT_PERMISSIONS) {
      expect(permission).not.toMatch(/^platform\./);
    }
  });

  it("gives an operator none", () => {
    const operator = { id: "x", email: "x@y.z", userName: "X", role: "operator" as const };
    expect(tenantPermissionsOf({ ...operator, tenant: null }).size).toBe(0);
  });
});
