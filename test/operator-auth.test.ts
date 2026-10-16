import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { OPERATOR_COOKIE } from "../src/auth/operator/operator-auth.routes.js";
import { hashPassword } from "../src/auth/shared/passwords.js";
import { createPool } from "../src/db/pool.js";
import { testConfig } from "./helpers/config.js";
import { captureLogs } from "./helpers/log-capture.js";

const run = promisify(execFile);

const OMAR_EMAIL = "omar@watheeq.sa";
const OMAR_PASSWORD = "correct horse battery staple";

const capture = captureLogs();
const pool = createPool(inject("databaseUrl"), capture.logger);
const admin = new pg.Pool({ connectionString: inject("adminDatabaseUrl"), max: 2 });
const app = buildApp({ pool, logger: capture.logger, config: testConfig() });

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", "src/cli/create-operator.ts", ...args],
      {
        env: {
          PATH: process.env.PATH ?? "",
          MIGRATION_DATABASE_URL: inject("ownerDatabaseUrl"),
          ...env,
        },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

interface LoginResult {
  status: number;
  body: { error: { code: string; requestId: string }; csrfToken: string; operator: unknown };
  token: string;
  csrf: string;
  setCookie: string;
}

async function login(email: string, password: string, cookie?: string): Promise<LoginResult> {
  const req = request(app).post("/operator/auth/login");
  if (cookie) {
    req.set("Cookie", `${OPERATOR_COOKIE}=${cookie}`);
  }
  const res = await req.send({ email, password });
  const setCookie = ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? [])[0] ?? "";
  const token = new RegExp(`^${OPERATOR_COOKIE}=([^;]*)`).exec(setCookie)?.[1] ?? "";
  return { status: res.status, body: res.body, token, csrf: res.body.csrfToken, setCookie };
}

const authed = (token: string) => `${OPERATOR_COOKIE}=${token}`;

async function sessionRow(token: string) {
  const { rows } = await admin.query(
    `SELECT id, encode(token_hash, 'hex') AS token_hash, last_seen_at, revoked_at, xmin::text AS xmin
       FROM operator_sessions WHERE token_hash = sha256($1::bytea)`,
    [Buffer.from(token)],
  );
  return rows[0];
}

beforeAll(async () => {
  // Criterion 1: Omar is created by the real CLI, not by a test fixture.
  const created = await runCli([OMAR_EMAIL], { OPERATOR_PASSWORD: OMAR_PASSWORD });
  expect(created.stderr).toBe("");
  expect(created.code).toBe(0);
  const hash = await hashPassword("some other password 123");
  await admin.query(
    "INSERT INTO operators (email, password_hash, is_active) VALUES ('inactive@watheeq.sa', $1, false)",
    [hash],
  );
});

afterAll(async () => {
  await pool.end();
  await admin.end();
});

describe("operator login and session", () => {
  it("lets Omar, created by the CLI, log in and read his session", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.operator).toEqual({ id: expect.any(String), email: OMAR_EMAIL });
    expect(res.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const session = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", authed(res.token));
    expect(session.status).toBe(200);
    expect(session.body.operator).toEqual(res.body.operator);
    expect(session.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("marks auth responses as uncacheable", async () => {
    const res = await request(app)
      .post("/operator/auth/login")
      .send({ email: OMAR_EMAIL, password: "wrong" });
    expect(res.headers["cache-control"]).toBe("no-store");
    const ok = await request(app).get("/operator/auth/session");
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("normalizes the email on login", async () => {
    const res = await login("  Omar@Watheeq.SA ", OMAR_PASSWORD);
    expect(res.status).toBe(200);
  });

  it("returns identical 401 bodies for a wrong password, an unknown email, and an inactive operator", async () => {
    const wrong = await login(OMAR_EMAIL, "wrong password");
    const unknown = await login("nobody@watheeq.sa", "wrong password");
    const inactive = await login("inactive@watheeq.sa", "some other password 123");
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
      .post("/operator/auth/login")
      .send({ email: OMAR_EMAIL, password: "x".repeat(257) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe("VALIDATION_FAILED");
    const missing = await request(app).post("/operator/auth/login").send({ email: OMAR_EMAIL });
    expect(missing.status).toBe(400);
    const noBody = await request(app).post("/operator/auth/login");
    expect(noBody.status).toBe(400);
  });

  it("returns 401 UNAUTHENTICATED without a cookie or with a junk cookie", async () => {
    const none = await request(app).get("/operator/auth/session");
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("UNAUTHENTICATED");
    const junk = await request(app).get("/operator/auth/session").set("Cookie", authed("junk"));
    expect(junk.status).toBe(401);
  });

  it("ignores the tenant cookie name (realm separation)", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const wrongName = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", `__Host-wq_session=${res.token}`);
    expect(wrongName.status).toBe(401);
  });
});

describe("cookie and stored session", () => {
  it("sets a __Host- cookie with HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    expect(res.setCookie).toMatch(/^__Host-wq_operator=[A-Za-z0-9_-]{43};/);
    const flags = res.setCookie.split(";").map((part) => part.trim().toLowerCase());
    expect(flags).toContain("httponly");
    expect(flags).toContain("secure");
    expect(flags).toContain("samesite=lax");
    expect(flags).toContain("path=/");
    expect(flags.some((flag) => flag.startsWith("domain"))).toBe(false);
  });

  it("stores only the SHA-256 hash of the session token and nothing for CSRF", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const row = await sessionRow(res.token);
    expect(row.token_hash).not.toBe(Buffer.from(res.token).toString("hex"));
    expect(row.token_hash).toBe(createHash("sha256").update(res.token).digest("hex"));
    const { rows } = await admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'operator_sessions' AND column_name LIKE '%csrf%'",
    );
    expect(rows).toEqual([]);
  });
});

describe("logout and CSRF", () => {
  it("rejects the old cookie after logout and clears the cookie", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const out = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", res.csrf);
    expect(out.status).toBe(204);
    const cleared = String((out.headers["set-cookie"] as unknown as string[])[0]);
    expect(cleared).toMatch(/^__Host-wq_operator=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const replay = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", authed(res.token));
    expect(replay.status).toBe(401);
    expect((await sessionRow(res.token)).revoked_at).not.toBeNull();
  });

  it("returns 403 CSRF_FAILED without a token and with a wrong token, and keeps the session", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const missing = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(res.token));
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("CSRF_FAILED");
    const wrong = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", "A".repeat(43));
    expect(wrong.status).toBe(403);
    const malformed = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", "short");
    expect(malformed.status).toBe(403);
    const still = await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    expect(still.status).toBe(200);
  });

  it("returns 401, not 403, for logout without a session", async () => {
    const res = await request(app).post("/operator/auth/logout");
    expect(res.status).toBe(401);
  });

  it("keeps the login CSRF token valid after GET /session, so a second tab does not break the first", async () => {
    // Omar logs in on tab A, then tab B reloads and recovers the token through GET /session.
    const tabA = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const tabB = await request(app).get("/operator/auth/session").set("Cookie", authed(tabA.token));
    expect(tabB.body.csrfToken).toBe(tabA.csrf);
    const out = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(tabA.token))
      .set("X-CSRF-Token", tabA.csrf);
    expect(out.status).toBe(204);
  });

  it("rejects one session's CSRF token on another session", async () => {
    const first = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const second = await login(OMAR_EMAIL, OMAR_PASSWORD);
    expect(second.csrf).not.toBe(first.csrf);
    const crossed = await request(app)
      .post("/operator/auth/logout")
      .set("Cookie", authed(second.token))
      .set("X-CSRF-Token", first.csrf);
    expect(crossed.status).toBe(403);
  });
});

describe("session validity", () => {
  it.each([
    [
      "revoked",
      "UPDATE operator_sessions SET revoked_at = now() WHERE token_hash = sha256($1::bytea)",
    ],
    [
      "past its absolute expiry",
      "UPDATE operator_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = sha256($1::bytea)",
    ],
    [
      "idle-expired",
      "UPDATE operator_sessions SET last_seen_at = now() - interval '31 minutes' WHERE token_hash = sha256($1::bytea)",
    ],
  ])("rejects a session that is %s", async (_label, sql) => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(res.token))).status,
    ).toBe(200);
    await admin.query(sql, [Buffer.from(res.token)]);
    const after = await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("accepts a session just inside the idle timeout", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    await admin.query(
      "UPDATE operator_sessions SET last_seen_at = now() - interval '29 minutes' WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(res.token))).status,
    ).toBe(200);
  });

  it("rejects the existing session of a deactivated operator on the next call", async () => {
    const hash = await hashPassword("temporary password 1");
    await admin.query(
      "INSERT INTO operators (email, password_hash) VALUES ('temp@watheeq.sa', $1)",
      [hash],
    );
    const res = await login("temp@watheeq.sa", "temporary password 1");
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(res.token))).status,
    ).toBe(200);
    await admin.query("UPDATE operators SET is_active = false WHERE email = 'temp@watheeq.sa'");
    const after = await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    expect(after.status).toBe(401);
  });

  it("sets the absolute expiry from configuration", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const { rows } = await admin.query(
      "SELECT extract(epoch FROM expires_at - created_at) AS seconds FROM operator_sessions WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    expect(Math.round(Number(rows[0].seconds))).toBe(8 * 3600);
  });
});

describe("login with an existing cookie", () => {
  it("issues a new token and revokes the old session", async () => {
    const first = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const second = await login(OMAR_EMAIL, OMAR_PASSWORD, first.token);
    expect(second.status).toBe(200);
    expect(second.token).not.toBe(first.token);
    expect((await sessionRow(first.token)).revoked_at).not.toBeNull();
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(first.token))).status,
    ).toBe(401);
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(second.token))).status,
    ).toBe(200);
  });

  it("never upgrades a planted token (fixation)", async () => {
    const planted = "P".repeat(43);
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD, planted);
    expect(res.token).not.toBe(planted);
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(planted))).status,
    ).toBe(401);
  });

  it("keeps the presented session when the login fails", async () => {
    const first = await login(OMAR_EMAIL, OMAR_PASSWORD);
    const failed = await login(OMAR_EMAIL, "wrong password", first.token);
    expect(failed.status).toBe(401);
    expect(
      (await request(app).get("/operator/auth/session").set("Cookie", authed(first.token))).status,
    ).toBe(200);
  });
});

describe("last_seen_at", () => {
  it("is not rewritten on every request", async () => {
    const res = await login(OMAR_EMAIL, OMAR_PASSWORD);
    // Fresh session: two requests within a minute write nothing.
    const before = await sessionRow(res.token);
    await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    expect((await sessionRow(res.token)).last_seen_at).toEqual(before.last_seen_at);

    // A session last seen 2 minutes ago: the first request updates it, the second does not.
    await admin.query(
      "UPDATE operator_sessions SET last_seen_at = now() - interval '2 minutes' WHERE token_hash = sha256($1::bytea)",
      [Buffer.from(res.token)],
    );
    const stale = await sessionRow(res.token);
    await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    const afterFirst = await sessionRow(res.token);
    expect(afterFirst.last_seen_at.getTime()).toBeGreaterThan(stale.last_seen_at.getTime());
    await request(app).get("/operator/auth/session").set("Cookie", authed(res.token));
    expect((await sessionRow(res.token)).last_seen_at).toEqual(afterFirst.last_seen_at);
  });
});

describe("logging", () => {
  it("never logs the password, the cookie value, or a CSRF token", async () => {
    const password = "a-very-distinctive-password-9137";
    const hash = await hashPassword(password);
    await admin.query(
      "INSERT INTO operators (email, password_hash) VALUES ('logs@watheeq.sa', $1)",
      [hash],
    );
    await login("logs@watheeq.sa", "wrong-distinctive-password-4242");
    const res = await login("logs@watheeq.sa", password);
    const session = await request(app)
      .get("/operator/auth/session")
      .set("Cookie", authed(res.token))
      .set("X-CSRF-Token", res.csrf);
    await request(app)
      .post("/operator/auth/logout")
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
    expect(logged).toContain("operator logged in");
    expect(logged).toContain("operator login failed");
    expect(logged).toContain("operator logged out");
  });
});

describe("grants", () => {
  it("lets the application role neither create nor delete operators", async () => {
    const app_ = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
    try {
      await expect(
        app_.query("INSERT INTO operators (email, password_hash) VALUES ('evil@watheeq.sa', 'x')"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(app_.query("DELETE FROM operators")).rejects.toMatchObject({ code: "42501" });
      await expect(app_.query("DELETE FROM operator_sessions")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await app_.end();
    }
  });
});

describe("operator:create CLI", () => {
  it("stores a normalized email and an argon2id hash, and echoes no secret", async () => {
    const out = await runCli(["Mixed.Case@Watheeq.SA"], {
      OPERATOR_PASSWORD: "cli-created-password-1",
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("mixed.case@watheeq.sa");
    expect(out.stdout + out.stderr).not.toContain("cli-created-password-1");
    const { rows } = await admin.query(
      "SELECT password_hash FROM operators WHERE email = 'mixed.case@watheeq.sa'",
    );
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await login("mixed.case@watheeq.sa", "cli-created-password-1")).status).toBe(200);
  });

  it("refuses a duplicate email, an invalid email, a short password, and extra arguments", async () => {
    const dup = await runCli([OMAR_EMAIL], { OPERATOR_PASSWORD: "another-password-123" });
    expect(dup.code).toBe(1);
    expect(dup.stderr).toContain("already exists");
    const bad = await runCli(["not-an-email"], { OPERATOR_PASSWORD: "another-password-123" });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("Invalid email");
    const short = await runCli(["short@watheeq.sa"], { OPERATOR_PASSWORD: "short" });
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("Invalid password");
    expect(short.stderr).not.toContain("short@");
    const argvPassword = await runCli(["argv@watheeq.sa", "secret-in-argv-123"], {});
    expect(argvPassword.code).toBe(1);
    expect(argvPassword.stderr).toContain("Usage");
    const { rows } = await admin.query(
      "SELECT count(*)::int AS n FROM operators WHERE email IN ('not-an-email','short@watheeq.sa','argv@watheeq.sa')",
    );
    expect(rows[0].n).toBe(0);
  });

  it("fails without a password source when stdin is not a terminal", async () => {
    const out = await runCli(["nopass@watheeq.sa"], {});
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("OPERATOR_PASSWORD");
  });
});
