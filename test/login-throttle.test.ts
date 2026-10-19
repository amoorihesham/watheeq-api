import type express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "./helpers/app.js";
import { hashPassword } from "./helpers/auth.js";
import { connectAsAdmin, connectAsApp, seedOperator, seedTenant, seedUser } from "./helpers/db.js";
import { captureLogs } from "./helpers/log-capture.js";

const PASSWORD = "throttle correct horse battery";

const capture = captureLogs();
const pool = connectAsApp(capture.logger);
const admin = connectAsAdmin();
// The test client plays the reverse proxy: with TRUST_PROXY=1 the client IP is the last X-Forwarded-For entry.
const proxied = testApp(pool, capture.logger, { config: { TRUST_PROXY: "1" } });
const direct = testApp(pool, capture.logger);

let tenantId = "";
let hash = "";
let counter = 0;
let ipCounter = 0;

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
  tenantId = (await seedTenant(admin, "Throttle Co")).id;
});

afterAll(async () => {
  await pool.end();
  await admin.end();
});

/** A documentation-range address (RFC 5737) nobody else in the suite uses, unique per call. */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

interface Realm {
  name: string;
  loginPath: string;
  table: "users" | "operators";
  createAccount(email: string): Promise<void>;
}

const realms: Realm[] = [
  {
    name: "tenant",
    loginPath: "/auth/login",
    table: "users",
    createAccount: async (email) => {
      await seedUser(admin, tenantId, { email, passwordHash: hash });
    },
  },
  {
    name: "operator",
    loginPath: "/operator/auth/login",
    table: "operators",
    createAccount: async (email) => {
      await seedOperator(admin, { email, passwordHash: hash });
    },
  },
];

async function newAccount(realm: Realm): Promise<string> {
  counter += 1;
  const email = `throttle${counter}@${realm.name}.test`;
  await realm.createAccount(email);
  return email;
}

function attempt(
  realm: Realm,
  email: string,
  password: string,
  forwardedFor: string,
  app: express.Express = proxied,
) {
  return request(app)
    .post(realm.loginPath)
    .set("X-Forwarded-For", forwardedFor)
    .send({ email, password });
}

async function accountRow(realm: Realm, email: string) {
  const { rows } = await admin.query(
    `SELECT failed_login_count, locked_until, locked_until > now() AS locked,
            extract(epoch FROM locked_until - now()) AS lock_remaining_seconds
       FROM ${realm.table} WHERE email = $1`,
    [email],
  );
  return rows[0];
}

async function ipRow(ip: string) {
  const { rows } = await admin.query(
    "SELECT failed_count, window_started_at FROM login_ip_throttle WHERE ip = $1::inet",
    [ip],
  );
  return rows[0] as { failed_count: number; window_started_at: Date } | undefined;
}

describe.each(realms)("$name login throttling", (realm) => {
  it("locks the account for 15 minutes after 5 consecutive failures, even for the right password", async () => {
    const email = await newAccount(realm);
    for (let i = 0; i < 5; i++) {
      const res = await attempt(realm, email, "wrong password", freshIp());
      expect(res.status).toBe(401);
    }
    const locked = await accountRow(realm, email);
    expect(locked.locked).toBe(true);
    expect(locked.failed_login_count).toBe(0);
    expect(Number(locked.lock_remaining_seconds)).toBeGreaterThan(14 * 60);
    expect(Number(locked.lock_remaining_seconds)).toBeLessThanOrEqual(15 * 60);

    // From yet another IP, with the right password: still 429, and no cookie.
    const right = await attempt(realm, email, PASSWORD, freshIp());
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(right.headers["set-cookie"]).toBeUndefined();
    const wrong = await attempt(realm, email, "wrong password", freshIp());
    expect(wrong.status).toBe(429);
  });

  it("does not verify the password or count against the IP while the account is locked", async () => {
    const email = await newAccount(realm);
    await admin.query(
      `UPDATE ${realm.table} SET locked_until = now() + interval '10 minutes' WHERE email = $1`,
      [email],
    );
    const ip = freshIp();
    const res = await attempt(realm, email, "wrong password", ip);
    expect(res.status).toBe(429);
    expect((await accountRow(realm, email)).failed_login_count).toBe(0);
    expect(await ipRow(ip)).toBeUndefined();
  });

  it("accepts the right password once the lock has expired and resets the count", async () => {
    const email = await newAccount(realm);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      await attempt(realm, email, "wrong password", ip);
    }
    expect((await attempt(realm, email, PASSWORD, ip)).status).toBe(429);
    await admin.query(
      `UPDATE ${realm.table} SET locked_until = now() - interval '1 second' WHERE email = $1`,
      [email],
    );
    const ok = await attempt(realm, email, PASSWORD, ip);
    expect(ok.status).toBe(200);
    const row = await accountRow(realm, email);
    expect(row.failed_login_count).toBe(0);
    expect(row.locked).toBeNull();
  });

  it("resets the account counter on success but not the IP counter", async () => {
    const email = await newAccount(realm);
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      await attempt(realm, email, "wrong password", ip);
    }
    expect((await accountRow(realm, email)).failed_login_count).toBe(3);
    expect((await ipRow(ip))?.failed_count).toBe(3);
    expect((await attempt(realm, email, PASSWORD, ip)).status).toBe(200);
    expect((await accountRow(realm, email)).failed_login_count).toBe(0);
    expect((await ipRow(ip))?.failed_count).toBe(3);
    // The counters keep counting from where the IP left off: 3 more failures means 6 for the IP, 3 for the account.
    for (let i = 0; i < 3; i++) {
      await attempt(realm, email, "wrong password", ip);
    }
    expect((await ipRow(ip))?.failed_count).toBe(6);
    expect((await accountRow(realm, email)).failed_login_count).toBe(3);
  });

  it("counts every kind of 401 against the IP: unknown email, wrong password, inactive account", async () => {
    const email = await newAccount(realm);
    const inactive = await newAccount(realm);
    await admin.query(`UPDATE ${realm.table} SET is_active = false WHERE email = $1`, [inactive]);
    const ip = freshIp();
    await attempt(realm, `nobody${counter}@${realm.name}.test`, "x", ip);
    await attempt(realm, email, "wrong password", ip);
    await attempt(realm, inactive, PASSWORD, ip);
    expect((await ipRow(ip))?.failed_count).toBe(3);
    // A right password on an inactive account does not feed the account counter.
    expect((await accountRow(realm, inactive)).failed_login_count).toBe(0);
  });

  it("blocks an IP after 100 failures in a window for every email (password spraying)", async () => {
    const ip = freshIp();
    const victim = await newAccount(realm);
    for (let batch = 0; batch < 10; batch++) {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          attempt(realm, `spray${batch * 10 + i}@${realm.name}.test`, "guess", ip),
        ),
      );
      for (const res of results) {
        expect(res.status).toBe(401);
      }
    }
    expect((await ipRow(ip))?.failed_count).toBe(100);

    const blocked = await attempt(realm, victim, PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(blocked.headers["set-cookie"]).toBeUndefined();
    expect((await attempt(realm, "another@x.test", "guess", ip)).status).toBe(429);
    // The 429s are not counted again, and another IP is unaffected.
    expect((await ipRow(ip))?.failed_count).toBe(100);
    expect((await attempt(realm, victim, PASSWORD, freshIp())).status).toBe(200);
  });

  it("stays below the limit for 99 failures and lets the right password through", async () => {
    const ip = freshIp();
    const email = await newAccount(realm);
    await admin.query(
      "INSERT INTO login_ip_throttle (ip, failed_count, window_started_at) VALUES ($1::inet, 99, now())",
      [ip],
    );
    expect((await attempt(realm, email, PASSWORD, ip)).status).toBe(200);
    expect((await attempt(realm, email, "wrong password", ip)).status).toBe(401);
    expect((await ipRow(ip))?.failed_count).toBe(100);
    expect((await attempt(realm, email, PASSWORD, ip)).status).toBe(429);
  });

  it("treats a stale window as zero and starts a new window on the next failure", async () => {
    const ip = freshIp();
    const email = await newAccount(realm);
    await admin.query(
      "INSERT INTO login_ip_throttle (ip, failed_count, window_started_at) VALUES ($1::inet, 100, now() - interval '15 minutes 1 second')",
      [ip],
    );
    // Not blocked: the window is stale.
    const ok = await attempt(realm, email, PASSWORD, ip);
    expect(ok.status).toBe(200);
    expect((await ipRow(ip))?.failed_count).toBe(100);
    const failed = await attempt(realm, email, "wrong password", ip);
    expect(failed.status).toBe(401);
    const row = await ipRow(ip);
    expect(row?.failed_count).toBe(1);
    expect(Date.now() - (row?.window_started_at.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it("keeps a window that is just inside 15 minutes", async () => {
    const ip = freshIp();
    await admin.query(
      "INSERT INTO login_ip_throttle (ip, failed_count, window_started_at) VALUES ($1::inet, 100, now() - interval '14 minutes')",
      [ip],
    );
    const res = await attempt(realm, "whoever@x.test", "x", ip);
    expect(res.status).toBe(429);
  });

  it("loses no increments when wrong passwords arrive concurrently", async () => {
    const email = await newAccount(realm);
    const ip = freshIp();
    const four = await Promise.all(
      Array.from({ length: 4 }, () => attempt(realm, email, "wrong password", ip)),
    );
    expect(four.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect((await accountRow(realm, email)).failed_login_count).toBe(4);
    expect((await ipRow(ip))?.failed_count).toBe(4);

    // One more failure completes the 5: the account locks and its count starts over.
    await attempt(realm, email, "wrong password", ip);
    expect((await accountRow(realm, email)).locked).toBe(true);
    expect((await ipRow(ip))?.failed_count).toBe(5);

    const second = await newAccount(realm);
    const five = await Promise.all(
      Array.from({ length: 5 }, () => attempt(realm, second, "wrong password", freshIp())),
    );
    expect(five.every((r) => r.status === 401)).toBe(true);
    const row = await accountRow(realm, second);
    expect(row.locked).toBe(true);
    expect(row.failed_login_count).toBe(0);
  });

  it("logs throttled logins without secrets", async () => {
    const email = await newAccount(realm);
    await admin.query(
      `UPDATE ${realm.table} SET locked_until = now() + interval '10 minutes' WHERE email = $1`,
      [email],
    );
    await attempt(realm, email, "log-check-password-5521", freshIp());
    const logged = JSON.stringify(capture.lines());
    expect(logged).toContain(`${realm.name} login throttled`);
    expect(logged).toContain("account_locked");
    expect(logged).not.toContain("log-check-password-5521");
  });
});

describe("TRUST_PROXY and the counted client IP", () => {
  const tenantRealm = realms[0] as Realm;

  it("counts the hop the trusted proxy appended, not entries the client supplied", async () => {
    const real = freshIp();
    const spoofed = ["1.2.3.4", "5.6.7.8", "9.9.9.9", "10.1.1.1"];
    for (const fake of spoofed) {
      const res = await attempt(tenantRealm, "nobody@x.test", "x", `${fake}, ${real}`);
      expect(res.status).toBe(401);
    }
    expect((await ipRow(real))?.failed_count).toBe(4);
    for (const fake of spoofed) {
      expect(await ipRow(fake)).toBeUndefined();
    }
  });

  it("blocks the real IP even when the attacker rotates fake X-Forwarded-For entries", async () => {
    const real = freshIp();
    await admin.query(
      "INSERT INTO login_ip_throttle (ip, failed_count, window_started_at) VALUES ($1::inet, 100, now())",
      [real],
    );
    const res = await attempt(tenantRealm, "nobody@x.test", "x", `203.0.113.77, ${real}`);
    expect(res.status).toBe(429);
  });

  it("falls back to the socket address when the trusted hop is not a valid IP", async () => {
    const before = (await ipRow("127.0.0.1"))?.failed_count ?? 0;
    const res = await attempt(tenantRealm, "nobody@x.test", "x", "not-an-ip");
    expect(res.status).toBe(401);
    expect((await ipRow("127.0.0.1"))?.failed_count).toBe(before + 1);
  });

  it("ignores X-Forwarded-For entirely when TRUST_PROXY is 0", async () => {
    const before = (await ipRow("127.0.0.1"))?.failed_count ?? 0;
    const fake = "203.0.113.200";
    const res = await attempt(tenantRealm, "nobody@x.test", "x", fake, direct);
    expect(res.status).toBe(401);
    expect(await ipRow(fake)).toBeUndefined();
    // The socket address (::ffff:127.0.0.1 on a dual-stack listener) is stored as plain IPv4.
    expect((await ipRow("127.0.0.1"))?.failed_count).toBe(before + 1);
  });

  it("stores the counted client IP on the session, in both realms", async () => {
    const ip = freshIp();
    const email = await newAccount(tenantRealm);
    const res = await attempt(tenantRealm, email, PASSWORD, `7.7.7.7, ${ip}`);
    expect(res.status).toBe(200);
    const { rows } = await admin.query(
      "SELECT ip FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    );
    expect(rows.map((r) => r.ip)).toEqual([ip]);

    const operatorRealm = realms[1] as Realm;
    const opEmail = await newAccount(operatorRealm);
    const opIp = freshIp();
    await attempt(operatorRealm, opEmail, PASSWORD, `7.7.7.7, ${opIp}`);
    const op = await admin.query(
      "SELECT ip FROM operator_sessions WHERE operator_id = (SELECT id FROM operators WHERE email = $1)",
      [opEmail],
    );
    expect(op.rows.map((r) => r.ip)).toEqual([opIp]);
  });

  it("counts every address in one IPv6 /64 as one client, so rotating addresses does not evade the limit", async () => {
    const prefix = "2001:db8:ab:1";
    for (let i = 1; i <= 4; i++) {
      const res = await attempt(tenantRealm, "nobody@x.test", "x", `${prefix}::${i.toString(16)}`);
      expect(res.status).toBe(401);
    }
    expect((await ipRow(`${prefix}::/64`))?.failed_count).toBe(4);
    expect(await ipRow(`${prefix}::1`)).toBeUndefined();
  });

  it("blocks a whole IPv6 /64 once it reaches the limit, but not its neighbouring /64", async () => {
    await admin.query(
      "INSERT INTO login_ip_throttle (ip, failed_count, window_started_at) VALUES ($1::inet, 100, now())",
      ["2001:db8:ab:2::/64"],
    );
    const blocked = await attempt(tenantRealm, "nobody@x.test", "x", "2001:db8:ab:2:ffff::9");
    expect(blocked.status).toBe(429);
    const neighbour = await attempt(tenantRealm, "nobody@x.test", "x", "2001:db8:ab:3::9");
    expect(neighbour.status).toBe(401);
  });

  it("stores the full IPv6 address on the session, not the /64 key", async () => {
    const realm = realms[0] as Realm;
    const email = await newAccount(realm);
    const res = await attempt(realm, email, PASSWORD, "2001:db8:ab:4::42");
    expect(res.status).toBe(200);
    const { rows } = await admin.query(
      "SELECT ip FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    );
    expect(rows.map((r) => r.ip)).toEqual(["2001:db8:ab:4::42"]);
  });

  it("shares one counter between the two realms for the same IP", async () => {
    const ip = freshIp();
    await attempt(realms[0] as Realm, "nobody@x.test", "x", ip);
    await attempt(realms[1] as Realm, "nobody@x.test", "x", ip);
    expect((await ipRow(ip))?.failed_count).toBe(2);
  });
});
