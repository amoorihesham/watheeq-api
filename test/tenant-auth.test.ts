import { createHash } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { testApp } from "./helpers/app.js";
import {
  hashPassword,
  type LoginResult,
  OPERATOR_COOKIE,
  realmClient,
  TENANT_COOKIE,
  TENANT_REALM,
  userSessionRow,
} from "./helpers/auth.js";
import { connectAsAdmin, connectAsApp, seedTenant, seedUser } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

const SARA_EMAIL = "sara.auth@alnoor.test";
const SARA_PASSWORD = "sara correct horse battery";
const KHALID_EMAIL = "khalid.auth@alrashid.test";
const KHALID_PASSWORD = "khalid correct horse battery";

const capture = captureLogs();
const pool = connectAsApp(capture.logger);
const admin = connectAsAdmin();
const app = testApp(pool, capture.logger);

const { login, authed } = realmClient(app, TENANT_REALM);
const sessionRow = (token: string) => userSessionRow(admin, token);

let alNoor = "";
let alRashid = "";

beforeAll(async () => {
  alNoor = (
    await seedTenant(admin, "Al-Noor", [
      { email: SARA_EMAIL, passwordHash: await hashPassword(SARA_PASSWORD) },
    ])
  ).id;
  alRashid = (
    await seedTenant(admin, "Al-Rashid", [
      { email: KHALID_EMAIL, passwordHash: await hashPassword(KHALID_PASSWORD) },
    ])
  ).id;
  const hash = await hashPassword("some other password 123");
  await seedUser(admin, alNoor, {
    email: "inactive@alnoor.test",
    passwordHash: hash,
    isActive: false,
  });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
});

describe("tenant login and session", () => {
  it("lets Sara log in and read her session", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: expect.any(String), email: SARA_EMAIL, tenantId: alNoor });
    expect(res.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const session = await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect(session.status).toBe(200);
    expect(session.body.user).toEqual(res.body.user);
    expect(session.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("marks auth responses as uncacheable", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: SARA_EMAIL, password: "wrong" });
    expect(res.headers["cache-control"]).toBe("no-store");
    const ok = await request(app).get("/auth/session");
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("normalizes the email on login", async () => {
    const res = await login("  Sara.Auth@AlNoor.TEST ", SARA_PASSWORD);
    expect(res.status).toBe(200);
  });

  it("returns identical 401 bodies for a wrong password, an unknown email, and an inactive user", async () => {
    const wrong = await login(SARA_EMAIL, "wrong password");
    const unknown = await login("nobody@alnoor.test", "wrong password");
    const inactive = await login("inactive@alnoor.test", "some other password 123");
    for (const res of [wrong, unknown, inactive]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(res.setCookie).toBe("");
    }
    const strip = (r: LoginResult) => ({ ...r.body, error: { ...r.body.error, requestId: "x" } });
    expect(strip(unknown)).toEqual(strip(wrong));
    expect(strip(inactive)).toEqual(strip(wrong));
  });

  it("validates the login body", async () => {
    const tooLong = await request(app)
      .post("/auth/login")
      .send({ email: SARA_EMAIL, password: "x".repeat(257) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe("VALIDATION_FAILED");
    const missing = await request(app).post("/auth/login").send({ email: SARA_EMAIL });
    expect(missing.status).toBe(400);
    const noBody = await request(app).post("/auth/login");
    expect(noBody.status).toBe(400);
  });

  it("returns 401 UNAUTHENTICATED without a cookie or with a junk cookie", async () => {
    const none = await request(app).get("/auth/session");
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("UNAUTHENTICATED");
    const junk = await request(app).get("/auth/session").set("Cookie", authed("junk"));
    expect(junk.status).toBe(401);
  });

  it("ignores the operator cookie name (realm separation)", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    const wrongName = await request(app)
      .get("/auth/session")
      .set("Cookie", `__Host-wq_operator=${res.token}`);
    expect(wrongName.status).toBe(401);
  });
});

describe("cookie and stored session", () => {
  it("sets a __Host- cookie with HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    expect(res.setCookie).toMatch(/^__Host-wq_session=[A-Za-z0-9_-]{43};/);
    const flags = res.setCookie.split(";").map((part) => part.trim().toLowerCase());
    expect(flags).toContain("httponly");
    expect(flags).toContain("secure");
    expect(flags).toContain("samesite=lax");
    expect(flags).toContain("path=/");
    expect(flags.some((flag) => flag.startsWith("domain"))).toBe(false);
  });

  it("stores only the SHA-256 hash of the session token and nothing for CSRF", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    const row = await sessionRow(res.token);
    expect(row.token_hash).not.toBe(Buffer.from(res.token).toString("hex"));
    expect(row.token_hash).toBe(createHash("sha256").update(res.token).digest("hex"));
    const { rows } = await admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name LIKE '%csrf%'",
    );
    expect(rows).toEqual([]);
  });
});

describe("logout and CSRF", () => {
  it("rejects the old cookie after logout and clears the cookie", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    const out = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", res.csrf);
    expect(out.status).toBe(204);
    const cleared = String((out.headers["set-cookie"] as unknown as string[])[0]);
    expect(cleared).toMatch(/^__Host-wq_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const replay = await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect(replay.status).toBe(401);
    expect((await sessionRow(res.token)).revoked_at).not.toBeNull();
  });

  it("returns 403 CSRF_FAILED without a token and with a wrong token, and keeps the session", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    const missing = await request(app).post("/auth/logout").set("Cookie", authed(res.token));
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("CSRF_FAILED");
    const wrong = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", "A".repeat(43));
    expect(wrong.status).toBe(403);
    const malformed = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", "short");
    expect(malformed.status).toBe(403);
    const still = await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect(still.status).toBe(200);
  });

  it("returns 401, not 403, for logout without a session", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(401);
  });

  it("keeps the login CSRF token valid after GET /session, so a second tab does not break the first", async () => {
    // Sara logs in on tab A, then tab B reloads and recovers the token through GET /session.
    const tabA = await login(SARA_EMAIL, SARA_PASSWORD);
    const tabB = await request(app).get("/auth/session").set("Cookie", authed(tabA.token));
    expect(tabB.body.csrfToken).toBe(tabA.csrf);
    const out = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(tabA.token))
      .set("X-CSRF-Token", tabA.csrf);
    expect(out.status).toBe(204);
  });

  it("rejects one session's CSRF token on another session", async () => {
    const first = await login(SARA_EMAIL, SARA_PASSWORD);
    const second = await login(SARA_EMAIL, SARA_PASSWORD);
    expect(second.csrf).not.toBe(first.csrf);
    const crossed = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(second.token))
      .set("X-CSRF-Token", first.csrf);
    expect(crossed.status).toBe(403);
  });
});

describe("session validity", () => {
  it.each([
    ["revoked", "UPDATE user_sessions SET revoked_at = now() WHERE token_hash = sha256($1::bytea)"],
    [
      "past its absolute expiry",
      "UPDATE user_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = sha256($1::bytea)",
    ],
    [
      "idle-expired",
      "UPDATE user_sessions SET last_seen_at = now() - interval '121 minutes' WHERE token_hash = sha256($1::bytea)",
    ],
  ])("rejects a session that is %s", async (_label, sql) => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    expect((await request(app).get("/auth/session").set("Cookie", authed(res.token))).status).toBe(
      200,
    );
    await admin.query(sql, [Buffer.from(res.token)]);
    const after = await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("accepts a session just inside the idle timeout", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    await admin.query(
      "UPDATE user_sessions SET last_seen_at = now() - interval '119 minutes' WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    expect((await request(app).get("/auth/session").set("Cookie", authed(res.token))).status).toBe(
      200,
    );
  });

  it("rejects the existing session of a deactivated user on the next call", async () => {
    const hash = await hashPassword("temporary password 1");
    await admin.query(
      "INSERT INTO users (tenant_id, email, password_hash) VALUES ($2, 'temp@alnoor.test', $1)",
      [hash, alNoor],
    );
    const res = await login("temp@alnoor.test", "temporary password 1");
    expect((await request(app).get("/auth/session").set("Cookie", authed(res.token))).status).toBe(
      200,
    );
    await admin.query("UPDATE users SET is_active = false WHERE email = 'temp@alnoor.test'");
    const after = await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect(after.status).toBe(401);
  });

  it("sets the absolute expiry from configuration", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    const { rows } = await admin.query(
      "SELECT extract(epoch FROM expires_at - created_at) AS seconds FROM user_sessions WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    expect(Math.round(Number(rows[0].seconds))).toBe(12 * 3600);
  });
});

describe("login with an existing cookie", () => {
  it("issues a new token and revokes the old session", async () => {
    const first = await login(SARA_EMAIL, SARA_PASSWORD);
    const second = await login(SARA_EMAIL, SARA_PASSWORD, first.token);
    expect(second.status).toBe(200);
    expect(second.token).not.toBe(first.token);
    expect((await sessionRow(first.token)).revoked_at).not.toBeNull();
    expect(
      (await request(app).get("/auth/session").set("Cookie", authed(first.token))).status,
    ).toBe(401);
    expect(
      (await request(app).get("/auth/session").set("Cookie", authed(second.token))).status,
    ).toBe(200);
  });

  it("never upgrades a planted token (fixation)", async () => {
    const planted = "P".repeat(43);
    const res = await login(SARA_EMAIL, SARA_PASSWORD, planted);
    expect(res.token).not.toBe(planted);
    expect((await request(app).get("/auth/session").set("Cookie", authed(planted))).status).toBe(
      401,
    );
  });

  it("keeps the presented session when the login fails", async () => {
    const first = await login(SARA_EMAIL, SARA_PASSWORD);
    const failed = await login(SARA_EMAIL, "wrong password", first.token);
    expect(failed.status).toBe(401);
    expect(
      (await request(app).get("/auth/session").set("Cookie", authed(first.token))).status,
    ).toBe(200);
  });
});

describe("last_seen_at", () => {
  it("is not rewritten on every request", async () => {
    const res = await login(SARA_EMAIL, SARA_PASSWORD);
    // Fresh session: two requests within a minute write nothing.
    const before = await sessionRow(res.token);
    await request(app).get("/auth/session").set("Cookie", authed(res.token));
    await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect((await sessionRow(res.token)).last_seen_at).toEqual(before.last_seen_at);

    // A session last seen 2 minutes ago: the first request updates it, the second does not.
    await admin.query(
      "UPDATE user_sessions SET last_seen_at = now() - interval '2 minutes' WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    const stale = await sessionRow(res.token);
    await request(app).get("/auth/session").set("Cookie", authed(res.token));
    const afterFirst = await sessionRow(res.token);
    expect(afterFirst.last_seen_at.getTime()).toBeGreaterThan(stale.last_seen_at.getTime());
    await request(app).get("/auth/session").set("Cookie", authed(res.token));
    expect((await sessionRow(res.token)).last_seen_at).toEqual(afterFirst.last_seen_at);
  });
});

describe("logging", () => {
  it("never logs the password, the cookie value, or a CSRF token", async () => {
    const password = "a-very-distinctive-password-9137";
    const hash = await hashPassword(password);
    await admin.query(
      "INSERT INTO users (tenant_id, email, password_hash) VALUES ($2, 'logs@alnoor.test', $1)",
      [hash, alNoor],
    );
    await login("logs@alnoor.test", "wrong-distinctive-password-4242");
    const res = await login("logs@alnoor.test", password);
    const session = await request(app)
      .get("/auth/session")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", res.csrf);
    await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", session.body.csrfToken);

    const logged = JSON.stringify(capture.lines());
    for (const secret of [
      password,
      "wrong-distinctive-password-4242",
      res.token,
      res.csrf,
      session.body.csrfToken,
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("tenant user logged in");
    expect(logged).toContain("tenant login failed");
    expect(logged).toContain("tenant user logged out");
  });
});

describe("tenant scoping", () => {
  it("gives each user a session in their own tenant only", async () => {
    const sara = await login(SARA_EMAIL, SARA_PASSWORD);
    const khalid = await login(KHALID_EMAIL, KHALID_PASSWORD);
    expect(sara.body.user).toMatchObject({ tenantId: alNoor });
    expect(khalid.body.user).toMatchObject({ tenantId: alRashid });
    const saraSession = await request(app).get("/auth/session").set("Cookie", authed(sara.token));
    const khalidSession = await request(app)
      .get("/auth/session")
      .set("Cookie", authed(khalid.token));
    expect(saraSession.body.user.tenantId).toBe(alNoor);
    expect(khalidSession.body.user.tenantId).toBe(alRashid);
    expect((await sessionRow(sara.token)).tenant_id).toBe(alNoor);
    expect((await sessionRow(khalid.token)).tenant_id).toBe(alRashid);
  });

  it("writes last_seen_at and revokes inside the session's own tenant", async () => {
    const khalid = await login(KHALID_EMAIL, KHALID_PASSWORD);
    await admin.query(
      "UPDATE user_sessions SET last_seen_at = now() - interval '2 minutes' WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(khalid.token)],
    );
    const stale = await sessionRow(khalid.token);
    const out = await request(app)
      .post("/auth/logout")
      .set("Cookie", authed(khalid.token))
      .set("X-CSRF-Token", khalid.csrf);
    expect(out.status).toBe(204);
    const after = await sessionRow(khalid.token);
    expect(after.revoked_at).not.toBeNull();
    expect(after.last_seen_at.getTime()).toBeGreaterThan(stale.last_seen_at.getTime());
  });
});

describe("realm separation", () => {
  const OMAR_EMAIL = "omar.realm@watheeq.sa";
  const OMAR_PASSWORD = "omar correct horse battery";
  let omarToken = "";

  beforeAll(async () => {
    await admin.query("INSERT INTO operators (email, password_hash) VALUES ($1, $2)", [
      OMAR_EMAIL,
      await hashPassword(OMAR_PASSWORD),
    ]);
    const res = await request(app)
      .post("/operator/auth/login")
      .send({ email: OMAR_EMAIL, password: OMAR_PASSWORD });
    omarToken = new RegExp(`^${OPERATOR_COOKIE}=([^;]*)`).exec(
      String((res.headers["set-cookie"] as unknown as string[])[0]),
    )?.[1] as string;
    expect(omarToken).toHaveLength(43);
  });

  it("rejects a tenant cookie on operator routes and an operator cookie on tenant routes", async () => {
    const sara = await login(SARA_EMAIL, SARA_PASSWORD);
    const tenantOnOperator = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", `${TENANT_COOKIE}=${sara.token}`);
    expect(tenantOnOperator.status).toBe(401);
    const operatorOnTenant = await request(app)
      .get("/auth/session")
      .set("Cookie", `${OPERATOR_COOKIE}=${omarToken}`);
    expect(operatorOnTenant.status).toBe(401);
  });

  it("rejects a token value presented under the other realm's cookie name", async () => {
    const sara = await login(SARA_EMAIL, SARA_PASSWORD);
    const saraUnderOperatorName = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", `${OPERATOR_COOKIE}=${sara.token}`);
    expect(saraUnderOperatorName.status).toBe(401);
    const omarUnderTenantName = await request(app)
      .get("/auth/session")
      .set("Cookie", `${TENANT_COOKIE}=${omarToken}`);
    expect(omarUnderTenantName.status).toBe(401);
    // Both genuine cookies still work on their own realm.
    expect((await request(app).get("/auth/session").set("Cookie", authed(sara.token))).status).toBe(
      200,
    );
    expect(
      (
        await request(app)
          .get("/operator/auth/session")
          .set("Cookie", `${OPERATOR_COOKIE}=${omarToken}`)
      ).status,
    ).toBe(200);
  });
});

describe("the lookup functions are the only RLS bypass", () => {
  const roleQuery = (sql: string, params: unknown[] = []) => {
    const client = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
    return client.query(sql, params).finally(() => client.end());
  };

  it("keeps watheeq_app out of watheeq_auth", async () => {
    const attrs = await admin.query(
      "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'watheeq_auth'",
    );
    expect(attrs.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: true });
    const members = await admin.query(
      `SELECT m.rolname FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = 'watheeq_auth'`,
    );
    expect(members.rows.map((r) => r.rolname)).toEqual(["watheeq_owner"]);
    const isMember = await roleQuery(
      "SELECT pg_has_role('watheeq_app', 'watheeq_auth', 'member') AS m",
    );
    expect(isMember.rows[0].m).toBe(false);
    await expect(roleQuery("SET ROLE watheeq_auth")).rejects.toMatchObject({ code: "42501" });
  });

  it("still enforces RLS on direct queries by watheeq_app", async () => {
    await expect(roleQuery("SELECT * FROM users")).rejects.toThrow(/tenant context is not set/);
    await expect(roleQuery("SELECT * FROM user_sessions")).rejects.toThrow(
      /tenant context is not set/,
    );
    await expect(roleQuery("SELECT * FROM tenants")).rejects.toThrow(/tenant context is not set/);
  });

  it("gives watheeq_auth SELECT on users and user_sessions and nothing else", async () => {
    const tables = await admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'watheeq_auth' ORDER BY table_name, privilege_type`,
    );
    expect(tables.rows).toEqual([
      { table_name: "user_sessions", privilege_type: "SELECT" },
      { table_name: "users", privilege_type: "SELECT" },
    ]);
    const schema = await admin.query(
      `SELECT has_schema_privilege('watheeq_auth', 'public', 'CREATE') AS can_create,
              has_schema_privilege('watheeq_auth', 'public', 'USAGE') AS can_use`,
    );
    expect(schema.rows[0]).toEqual({ can_create: false, can_use: true });
    const owned = await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE r.rolname = 'watheeq_auth' ORDER BY p.proname`,
    );
    expect(owned.rows.map((r) => r.proname)).toEqual([
      "auth_find_user_for_login",
      "auth_resolve_user_session",
    ]);
    const ownedRelations = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'watheeq_auth'`,
    );
    expect(ownedRelations.rows).toEqual([]);
  });

  it("makes the functions SECURITY DEFINER with a pinned search_path, executable by watheeq_app only", async () => {
    const { rows } = await admin.query(
      `SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig,
              has_function_privilege('watheeq_app', p.oid, 'EXECUTE') AS app_can_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
         FROM pg_proc p WHERE p.proname LIKE 'auth_%' ORDER BY p.proname`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        prosecdef: true,
        provolatile: "s",
        proconfig: ["search_path=pg_catalog, public"],
        app_can_execute: true,
        public_can_execute: false,
      });
    }
  });

  it("returns only the requested user from the login lookup, whatever tenant it belongs to", async () => {
    const found = await roleQuery("SELECT * FROM auth_find_user_for_login($1)", [KHALID_EMAIL]);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].tenant_id).toBe(alRashid);
    const none = await roleQuery("SELECT * FROM auth_find_user_for_login($1)", ["nobody@x.test"]);
    expect(none.rows).toEqual([]);
  });
});

describe("grants", () => {
  it("lets the application role neither create nor delete operators, nor delete sessions", async () => {
    const app_ = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
    try {
      await expect(
        app_.query("INSERT INTO operators (email, password_hash) VALUES ('evil@watheeq.sa', 'x')"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(app_.query("DELETE FROM operators")).rejects.toMatchObject({ code: "42501" });
      await expect(app_.query("DELETE FROM user_sessions")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await app_.end();
    }
  });
});
