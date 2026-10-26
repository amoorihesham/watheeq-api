import express from "express";
import { decodeJwt, SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, principalOf, requireRole } from "../src/modules/auth/index.js";
import { TENANT_PERMISSIONS } from "../src/modules/tenant-access/index.js";
import { testApp } from "./helpers/app.js";
import {
  ACCESS_COOKIE,
  accessCookie,
  cookieValue,
  hashPassword,
  login,
  REFRESH_COOKIE,
  refreshCookie,
  setCookiesOf,
  storedHashOf,
} from "./helpers/auth.js";
import { runCreateOperator } from "./helpers/cli.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";
import { connectToTestDb, seedTenant, seedUser } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@auth-alnoor.test";
const KHALID = "khalid@auth-alnoor.test";
const INACTIVE = "inactive@auth-alnoor.test";
const OMAR = "omar@auth-watheeq.test";

const capture = captureLogs();
const pool = connectToTestDb(capture.logger);

// Test-only route guarded like a Phase 1 operator route.
const operatorOnly = express.Router();
operatorOnly.get(
  "/operator-only",
  authenticate(TEST_JWT_SECRET),
  requireRole("operator"),
  (req, res) => {
    res.json({ userId: principalOf(req).id });
  },
);
const app = testApp(pool, capture.logger, { routers: [operatorOnly] });

let alNoor = "";
let adminRoleId = "";
let memberRoleId = "";
let saraId = "";
let khalidId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedTenant(pool, "auth-al-noor", [
    { email: SARA, userName: "Sara Al-Qahtani", passwordHash },
    { email: KHALID, userName: "Khalid Al-Otaibi", passwordHash },
  ]);
  ({ id: alNoor, adminRoleId, memberRoleId } = tenant);
  [saraId = "", khalidId = ""] = tenant.userIds;
  await seedUser(pool, { email: INACTIVE, passwordHash, isActive: false });
  const created = await runCreateOperator([OMAR, "Omar Al-Harbi"], { OPERATOR_PASSWORD: PASSWORD });
  expect(created.code).toBe(0);
});

afterAll(async () => {
  await pool.end();
});

const refreshRow = async (token: string) => {
  const { rows } = await pool.query(
    "select user_id, revoked_at, expires_at from refresh_tokens where token_hash = $1",
    [storedHashOf(token)],
  );
  return rows[0];
};

const me = (access: string) => request(app).get("/auth/me").set("Cookie", accessCookie(access));
const refresh = (token: string) =>
  request(app).post("/auth/refresh").set("Cookie", refreshCookie(token));

describe("login (R0.10, R0.11)", () => {
  it("logs Sara in with both cookies and her tenant and tenant role", async () => {
    const {
      res,
      access,
      refresh: refreshToken,
    } = await login(app, "  Sara@Auth-AlNoor.test ", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        user: {
          id: saraId,
          email: SARA,
          userName: "Sara Al-Qahtani",
          role: "user",
          tenant: {
            id: alNoor,
            roleId: adminRoleId,
            roleName: "Tenant Admin",
            permissions: TENANT_PERMISSIONS,
          },
        },
        subscription: null,
      },
    });
    expect(res.headers["cache-control"]).toBe("no-store");

    const cookies = setCookiesOf(res);
    expect(cookies[ACCESS_COOKIE]).toMatch(
      /; Max-Age=1800; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(cookies[REFRESH_COOKIE]).toMatch(
      /; Max-Age=604800; Path=\/auth; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
    );

    const payload = decodeJwt(access);
    expect(payload).toEqual({
      sub: saraId,
      iss: "watheeq_api",
      iat: expect.any(Number),
      exp: expect.any(Number),
      username: "Sara Al-Qahtani",
      email: SARA,
      role: "user",
      tenant: {
        id: alNoor,
        roleId: adminRoleId,
        roleName: "Tenant Admin",
        permissions: TENANT_PERMISSIONS,
      },
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(1800);
    const row = await refreshRow(refreshToken);
    expect(row).toMatchObject({ user_id: saraId, revoked_at: null });
    const { rows } = await pool.query(
      "select count(*)::int as n from refresh_tokens where token_hash = $1",
      [refreshToken],
    );
    expect(rows[0].n).toBe(0);
  });

  it("gives Khalid his role and exactly its permissions (R3.13)", async () => {
    const { access } = await login(app, KHALID, PASSWORD);
    expect(decodeJwt(access)).toMatchObject({
      sub: khalidId,
      tenant: { roleId: memberRoleId, roleName: "Member", permissions: ["org.view", "user.view"] },
    });
  });

  it("logs in an operator created by the CLI, with no tenant (R0.13)", async () => {
    const { res, access } = await login(app, OMAR, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      email: OMAR,
      userName: "Omar Al-Harbi",
      role: "operator",
      tenant: null,
    });
    expect(decodeJwt(access)).toMatchObject({ role: "operator", tenant: null });
  });

  it("answers a wrong password, an unknown email, and an inactive account identically", async () => {
    const attempts = await Promise.all([
      login(app, SARA, "wrong password"),
      login(app, "nobody@auth-alnoor.test", PASSWORD),
      login(app, INACTIVE, PASSWORD),
    ]);
    for (const { res } of attempts) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: "INVALID_CREDENTIALS", requestId: res.headers["x-request-id"], details: [] },
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("answers login and refresh with exactly what /auth/me answers (Q17)", async () => {
    const { res, access, refresh: refreshToken } = await login(app, SARA, PASSWORD);
    expect(res.body).toEqual((await me(access)).body);
    const refreshed = await refresh(refreshToken);
    expect(refreshed.body).toEqual(res.body);
  });

  it("rejects a malformed body and an oversized password before any lookup", async () => {
    const bad = await request(app).post("/auth/login").send({ email: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual([
      { path: "email", code: "invalid_format" },
      { path: "password", code: "invalid_type" },
    ]);
    const long = await request(app)
      .post("/auth/login")
      .send({ email: SARA, password: "x".repeat(257) });
    expect(long.status).toBe(400);
  });

  it("never logs the password or a token", async () => {
    const { access, refresh: refreshToken } = await login(app, SARA, PASSWORD);
    const text = JSON.stringify(capture.lines());
    expect(text).toContain("user logged in");
    for (const secret of [PASSWORD, access, refreshToken]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("access token (R0.11)", () => {
  it("lets Sara read /auth/me", async () => {
    const { access } = await login(app, SARA, PASSWORD);
    const res = await me(access);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: saraId, tenant: { roleName: "Tenant Admin" } });
  });

  const sign = (
    claims: Record<string, unknown>,
    secret: string,
    expiresAt: number | string,
    issuer = "watheeq_api",
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(saraId)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(secret));
  const claims = { username: "Sara Al-Qahtani", email: SARA, role: "user", tenant: null };

  it("accepts a hand-signed token with the expected issuer and claims (control for the cases below)", async () => {
    const res = await me(await sign(claims, TEST_JWT_SECRET, "30m"));
    expect(res.status).toBe(200);
  });

  it.each([
    ["no cookie", async () => ""],
    ["a tampered token", async () => `${(await login(app, SARA, PASSWORD)).access.slice(0, -2)}xx`],
    ["an expired token", () => sign(claims, TEST_JWT_SECRET, Math.floor(Date.now() / 1000) - 10)],
    [
      "a token signed with another secret",
      () => sign(claims, "another-secret-of-at-least-32-chars!", "30m"),
    ],
    ["a token with unexpected claims", () => sign({ role: "superuser" }, TEST_JWT_SECRET, "30m")],
    ["a token from another issuer", () => sign(claims, TEST_JWT_SECRET, "30m", "another_api")],
    [
      "a pre-Phase-3 token with no role id",
      () =>
        sign(
          { ...claims, tenant: { id: alNoor, roleId: null, roleName: "admin", permissions: [] } },
          TEST_JWT_SECRET,
          "30m",
        ),
    ],
  ])("rejects %s with 401 UNAUTHENTICATED", async (_label, tokenFor) => {
    const token = await tokenFor();
    const res = token ? await me(token) : await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("lets only operators through requireRole('operator')", async () => {
    const sara = await login(app, SARA, PASSWORD);
    const omar = await login(app, OMAR, PASSWORD);
    const asSara = await request(app)
      .get("/operator-only")
      .set("Cookie", accessCookie(sara.access));
    expect(asSara.status).toBe(403);
    expect(asSara.body.error.code).toBe("FORBIDDEN");
    const asOmar = await request(app)
      .get("/operator-only")
      .set("Cookie", accessCookie(omar.access));
    expect(asOmar.status).toBe(200);
    expect((await request(app).get("/operator-only")).status).toBe(401);
  });
});

describe("refresh (R0.12a)", () => {
  it("rotates: new cookies, the old token revoked and refused on replay", async () => {
    const first = await login(app, SARA, PASSWORD);
    const res = await refresh(first.refresh);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: saraId });
    const cookies = setCookiesOf(res);
    const nextRefresh = cookieValue(cookies[REFRESH_COOKIE]);
    expect(nextRefresh).not.toBe(first.refresh);
    expect((await refreshRow(first.refresh)).revoked_at).not.toBeNull();
    expect((await refreshRow(nextRefresh)).revoked_at).toBeNull();

    const replay = await refresh(first.refresh);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("UNAUTHENTICATED");
    const cleared = setCookiesOf(replay);
    expect(cleared[ACCESS_COOKIE]).toMatch(/^wq_access=; Path=\/; Expires=Thu, 01 Jan 1970/);
    expect(cleared[REFRESH_COOKIE]).toMatch(/^wq_refresh=; Path=\/auth; Expires=Thu, 01 Jan 1970/);
  });

  it("refuses a missing, unknown, or expired refresh token", async () => {
    expect((await request(app).post("/auth/refresh")).status).toBe(401);
    expect((await refresh("not-a-token-we-issued")).status).toBe(401);
    const { refresh: token } = await login(app, SARA, PASSWORD);
    await pool.query(
      "update refresh_tokens set expires_at = now() - interval '1 second' where token_hash = $1",
      [storedHashOf(token)],
    );
    expect((await refresh(token)).status).toBe(401);
  });

  it("logs out a deactivated user at the next refresh, while the access token runs out", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const userId = await seedUser(pool, { email: "leaver@auth-alnoor.test", passwordHash });
    const session = await login(app, "leaver@auth-alnoor.test", PASSWORD);
    await pool.query("update users set is_active = false where id = $1", [userId]);

    // The access token reads no database row, so it keeps working until it expires (at most 30 minutes).
    expect((await me(session.access)).status).toBe(200);
    expect((await refresh(session.refresh)).status).toBe(401);
  });

  it("carries a role change into the next access token", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const userId = await seedUser(pool, { email: "promoted@auth-alnoor.test", passwordHash });
    await pool.query(
      "insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
      [alNoor, userId, memberRoleId],
    );
    const session = await login(app, "promoted@auth-alnoor.test", PASSWORD);
    expect(decodeJwt(session.access)).toMatchObject({
      tenant: { roleId: memberRoleId, roleName: "Member", permissions: ["org.view", "user.view"] },
    });

    await pool.query("update tenant_members set role_id = $2 where user_id = $1", [
      userId,
      adminRoleId,
    ]);
    const res = await refresh(session.refresh);
    const access = cookieValue(setCookiesOf(res)[ACCESS_COOKIE]);
    expect(decodeJwt(access)).toMatchObject({
      tenant: { roleId: adminRoleId, roleName: "Tenant Admin", permissions: TENANT_PERMISSIONS },
    });
  });

  it("lets exactly one of two concurrent refreshes with the same token succeed", async () => {
    const { refresh: token } = await login(app, SARA, PASSWORD);
    const results = await Promise.all([refresh(token), refresh(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe("logout (R0.12)", () => {
  it("revokes the refresh token and clears both cookies", async () => {
    const session = await login(app, SARA, PASSWORD);
    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", refreshCookie(session.refresh));
    expect(res.status).toBe(204);
    const cleared = setCookiesOf(res);
    expect(cleared[ACCESS_COOKIE]).toMatch(/^wq_access=; Path=\/; Expires=Thu, 01 Jan 1970/);
    expect(cleared[REFRESH_COOKIE]).toMatch(/^wq_refresh=; Path=\/auth; Expires=Thu, 01 Jan 1970/);
    expect((await refreshRow(session.refresh)).revoked_at).not.toBeNull();
    expect((await refresh(session.refresh)).status).toBe(401);
  });

  it("succeeds without a cookie", async () => {
    expect((await request(app).post("/auth/logout")).status).toBe(204);
  });
});
