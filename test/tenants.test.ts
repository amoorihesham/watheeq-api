import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { withTx } from "../src/db/tx.js";
import { DEFAULT_WEEK } from "../src/modules/calendar/index.js";
import { assertSeatAvailable } from "../src/modules/subscriptions/index.js";
import { systemRoleGrants, TENANT_PERMISSIONS } from "../src/modules/tenant-access/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { TEST_APP_BASE_URL } from "./helpers/config.js";
import { connectToTestDb, rejectionText, seedTenant, seedUser } from "./helpers/db.js";
import { createFakeEmailSender } from "./helpers/email.js";
import { captureLogs } from "./helpers/log-capture.js";

const PASSWORD = "correct horse battery staple";
const SARA_PASSWORD = "sara chooses a long password";
const capture = captureLogs();
const pool = connectToTestDb(capture.logger);
const email = createFakeEmailSender();
const app = testApp(pool, capture.logger, { emailSender: email.sender });

let omar = "";
let omarId = "";
let tenantUser = "";
let basicId = "";
let today = "";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const as = (access: string) => ({
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
});

const tenantBody = (slug: string, adminEmail: string, overrides: Record<string, unknown> = {}) => ({
  name: `Tenant ${slug}`,
  slug,
  admin: { email: adminEmail, userName: "Sara Al-Qahtani" },
  subscription: {
    planId: basicId,
    startDate: today,
    endDate: addDays(today, 364),
    customerDiscountPercent: 10,
  },
  ...overrides,
});

const createTenant = (slug: string, adminEmail: string, overrides: Record<string, unknown> = {}) =>
  as(omar).post("/operator/tenants", tenantBody(slug, adminEmail, overrides));

const verify = (token: string, password = SARA_PASSWORD) =>
  request(app).post("/auth/verify").send({ token, password });

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  omarId = await seedUser(pool, {
    email: "omar@tenants-watheeq.test",
    passwordHash,
    role: "operator",
  });
  await seedTenant(pool, "tenants-existing", [
    { email: "khalid@tenants-alrashid.test", passwordHash },
  ]);
  omar = (await login(app, "omar@tenants-watheeq.test", PASSWORD)).access;
  tenantUser = (await login(app, "khalid@tenants-alrashid.test", PASSWORD)).access;
  const plan = await as(omar).post("/operator/plans", {
    name: "Tenants Basic",
    userLimit: 10,
    storageLimitGb: 10,
    graceDays: 14,
    priceHalalas: 100_000,
    paymentPeriod: "monthly",
    discountPercent: 15,
  });
  basicId = plan.body.plan.id;
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
});

afterAll(async () => {
  await pool.end();
});

describe("create a tenant (R1.3, R1.14)", () => {
  it("creates Al-Noor, its subscription with copied terms, and Sara as pending admin, in one go", async () => {
    const res = await createTenant("tn-al-noor", "Sara@Tenants-AlNoor.test");
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { tenant, subscription, admin } = res.body;
    expect(tenant).toMatchObject({
      name: "Tenant tn-al-noor",
      slug: "tn-al-noor",
      ownerId: admin.id,
    });
    expect(admin).toEqual({ id: expect.any(String), email: "sara@tenants-alnoor.test" });
    expect(subscription).toEqual({
      planId: basicId,
      planName: "Tenants Basic",
      userLimit: 10,
      storageLimitGb: 10,
      graceDays: 14,
      startDate: today,
      endDate: addDays(today, 364),
      graceEndsOn: addDays(today, 378),
      state: "active",
      pricing: {
        priceHalalas: 100_000,
        paymentPeriod: "monthly",
        planDiscountPercent: 15,
        customerDiscountPercent: 10,
        effectivePriceHalalas: 76_500,
      },
    });

    const user = await pool.query(
      "select user_name, password_hash, email_verified_at, role from users where id = $1",
      [admin.id],
    );
    expect(user.rows[0]).toEqual({
      user_name: "Sara Al-Qahtani",
      password_hash: null,
      email_verified_at: null,
      role: "user",
    });
    // The only role a new tenant starts with is Tenant Admin, and the owner holds it (R3.2, P3.9).
    const roles = await pool.query("select id, name, is_system from roles where tenant_id = $1", [
      tenant.id,
    ]);
    expect(roles.rows).toEqual([{ id: expect.any(String), name: "Tenant Admin", is_system: true }]);
    const member = await pool.query(
      "select tenant_id, role_id from tenant_members where user_id = $1",
      [admin.id],
    );
    expect(member.rows[0]).toEqual({ tenant_id: tenant.id, role_id: roles.rows[0].id });

    const audit = await pool.query(
      "select action, actor_type, actor_id from audit_log where tenant_id = $1 order by id",
      [tenant.id],
    );
    expect(audit.rows).toEqual(
      [
        "tenant.created",
        "subscription.assigned",
        "role.created",
        "user.created",
        "calendar.hours_set",
      ].map((action) => ({
        action,
        actor_type: "operator",
        actor_id: omarId,
      })),
    );
    const roleAudit = await pool.query(
      "select resource_id, details from audit_log where tenant_id = $1 and action = 'role.created'",
      [tenant.id],
    );
    expect(roleAudit.rows[0]).toEqual({
      resource_id: roles.rows[0].id,
      details: { name: "Tenant Admin", isSystem: true, permissions: systemRoleGrants() },
    });

    // The calendar starts with the default normal hours from today (R4.1).
    const hours = await pool.query(
      "select effective_from::text, week from working_hours where tenant_id = $1",
      [tenant.id],
    );
    expect(hours.rows).toEqual([{ effective_from: today, week: DEFAULT_WEEK }]);
  });

  it("emails Sara a link to the web app, and stores only the token's hash", async () => {
    const message = email.sent.filter((m) => m.to === "sara@tenants-alnoor.test").at(-1);
    expect(message?.subject).toContain("Verify your Watheeq email");
    expect(message?.text).toContain("Sara Al-Qahtani");
    expect(message?.text).toContain(`${TEST_APP_BASE_URL}/verify-email?token=`);
    const token = email.lastTokenFor("sara@tenants-alnoor.test");
    const { rows } = await pool.query(
      "select token_hash, used_at, expires_at - created_at as ttl from password_tokens where token_hash = $1",
      [hashOf(token)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].used_at).toBeNull();
    expect(rows[0].ttl.hours ?? rows[0].ttl.days * 24).toBeGreaterThanOrEqual(71);
    const stored = await pool.query(
      "select count(*)::int as n from password_tokens where token_hash = $1",
      [token],
    );
    expect(stored.rows[0].n).toBe(0);
  });

  it("never logs the verification token", () => {
    const token = email.lastTokenFor("sara@tenants-alnoor.test");
    expect(JSON.stringify(capture.lines())).not.toContain(token);
  });

  it("refuses an email that already belongs to a user, leaving nothing behind (R1.3)", async () => {
    const res = await createTenant("tn-al-noor-2", "sara@tenants-alnoor.test");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TAKEN");
    expect(res.body.error.details).toEqual([{ path: "admin.email", code: "taken" }]);
    const { rows } = await pool.query(
      "select count(*)::int as n from tenants where slug = 'tn-al-noor-2'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses a taken slug and rolls back the admin it had already inserted", async () => {
    const res = await createTenant("tn-al-noor", "other-admin@tenants-alnoor.test");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TAKEN");
    expect(res.body.error.details).toEqual([{ path: "slug", code: "taken" }]);
    const { rows } = await pool.query(
      "select count(*)::int as n from users where email = 'other-admin@tenants-alnoor.test'",
    );
    expect(rows[0].n).toBe(0);
  });

  it.each([
    [
      "an unknown plan",
      { planId: "00000000-0000-4000-8000-000000000000" },
      "subscription.planId",
      "unknown_plan",
    ],
    [
      "a start date in the future",
      { startDate: "2999-01-01", endDate: "2999-12-31" },
      "subscription.startDate",
      "in_future",
    ],
    [
      "an end date before the start date",
      { endDate: "2000-01-01" },
      "subscription.endDate",
      "end_before_start",
    ],
    [
      "a customer discount with three decimals",
      { customerDiscountPercent: 12.345 },
      "subscription.customerDiscountPercent",
      "too_many_decimals",
    ],
  ])("rejects %s with 400", async (_label, change, path, code) => {
    const body = tenantBody("tn-al-bad", "bad@tenants-alnoor.test");
    const res = await as(omar).post("/operator/tenants", {
      ...body,
      subscription: { ...body.subscription, ...change },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ path, code });
  });

  it.each([
    ["a slug with spaces", { slug: "Al Noor" }, "slug"],
    ["a one-character slug", { slug: "a" }, "slug"],
    ["a blank name", { name: "  " }, "name"],
    ["a missing admin name", { admin: { email: "x@tenants-alnoor.test" } }, "admin.userName"],
  ])("rejects %s with 400", async (_label, change, path) => {
    const res = await createTenant("tn-al-bad", "bad@tenants-alnoor.test", change);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it("accepts a one-day term (no minimum term), defaulting the customer discount to 0", async () => {
    const oneDay = await createTenant("tn-al-oneday", "oneday@tenants-alnoor.test", {
      subscription: { planId: basicId, startDate: today, endDate: today },
    });
    expect(oneDay.status).toBe(201);
    expect(oneDay.body.subscription.pricing.customerDiscountPercent).toBe(0);
  });

  it("still creates the tenant when the email cannot be sent, and logs the failure", async () => {
    email.failNext();
    const res = await createTenant("tn-al-nomail", "nomail@tenants-alnoor.test");
    expect(res.status).toBe(201);
    const warn = capture
      .lines()
      .find(
        (line) => line.msg === "verification email failed" && line.tenantId === res.body.tenant.id,
      );
    expect(warn?.level).toBe(40);
  });
});

describe("verify email and log in (R1.4)", () => {
  it("refuses Sara's login before she verifies, exactly like an unknown email", async () => {
    const pending = await login(app, "sara@tenants-alnoor.test", "anything at all");
    const unknown = await login(app, "nobody@tenants-alnoor.test", "anything at all");
    expect(pending.res.status).toBe(401);
    expect(pending.res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a short password without using up the link", async () => {
    const token = email.lastTokenFor("sara@tenants-alnoor.test");
    const res = await verify(token, "short");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    const { rows } = await pool.query("select used_at from password_tokens where token_hash = $1", [
      hashOf(token),
    ]);
    expect(rows[0].used_at).toBeNull();
  });

  it("lets Sara set her password through the link, then log in as Al-Noor's admin", async () => {
    const token = email.lastTokenFor("sara@tenants-alnoor.test");
    const res = await verify(token);
    expect(res.status).toBe(204);

    const session = await login(app, "sara@tenants-alnoor.test", SARA_PASSWORD);
    expect(session.res.status).toBe(200);
    expect(session.res.body.user).toMatchObject({
      userName: "Sara Al-Qahtani",
      tenant: { roleName: "Tenant Admin", permissions: TENANT_PERMISSIONS },
    });

    const audit = await pool.query(
      "select actor_type, actor_id, tenant_id from audit_log where action = 'user.email_verified' and actor_id = $1",
      [session.res.body.user.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "user",
        actor_id: session.res.body.user.id,
        tenant_id: session.res.body.user.tenant.id,
      },
    ]);
  });

  it("refuses a used link", async () => {
    const res = await verify(email.lastTokenFor("sara@tenants-alnoor.test"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VERIFICATION_INVALID");
  });

  it("refuses an unknown and an expired link", async () => {
    expect((await verify("not-a-token-we-sent")).body.error.code).toBe("VERIFICATION_INVALID");
    await createTenant("tn-al-expired", "expired@tenants-alnoor.test");
    const token = email.lastTokenFor("expired@tenants-alnoor.test");
    await pool.query(
      "update password_tokens set expires_at = now() - interval '1 second' where token_hash = $1",
      [hashOf(token)],
    );
    expect((await verify(token)).body.error.code).toBe("VERIFICATION_INVALID");
  });

  it("verifies a double-submitted link exactly once", async () => {
    await createTenant("tn-al-double", "double@tenants-alnoor.test");
    const token = email.lastTokenFor("double@tenants-alnoor.test");
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });
});

describe("resend verification (R1.4, P1.16)", () => {
  it("sends a new link and makes the older one stop working", async () => {
    const created = await createTenant("tn-al-resend", "resend@tenants-alnoor.test");
    const first = email.lastTokenFor("resend@tenants-alnoor.test");
    const res = await as(omar).post(
      `/operator/tenants/${created.body.tenant.id}/admin/resend-verification`,
    );
    expect(res.status).toBe(204);
    const second = email.lastTokenFor("resend@tenants-alnoor.test");
    expect(second).not.toBe(first);
    expect((await verify(first)).body.error.code).toBe("VERIFICATION_INVALID");
    expect((await verify(second)).status).toBe(204);

    const audit = await pool.query(
      "select actor_id from audit_log where action = 'user.verification_resent' and tenant_id = $1",
      [created.body.tenant.id],
    );
    expect(audit.rows).toEqual([{ actor_id: omarId }]);
  });

  it("refuses an admin who already verified, an unknown tenant, and a non-UUID", async () => {
    const alNoor = await pool.query("select id from tenants where slug = 'tn-al-noor'");
    const verified = await as(omar).post(
      `/operator/tenants/${alNoor.rows[0].id}/admin/resend-verification`,
    );
    expect(verified.status).toBe(409);
    expect(verified.body.error.code).toBe("ALREADY_VERIFIED");
    expect(
      (
        await as(omar).post(
          "/operator/tenants/00000000-0000-4000-8000-000000000000/admin/resend-verification",
        )
      ).status,
    ).toBe(404);
    expect(
      (await as(omar).post("/operator/tenants/not-a-uuid/admin/resend-verification")).status,
    ).toBe(404);
  });

  it("answers 500 when the email cannot be sent, so Omar is not told it went out", async () => {
    const created = await createTenant("tn-al-resend-fail", "resendfail@tenants-alnoor.test");
    email.failNext();
    const res = await as(omar).post(
      `/operator/tenants/${created.body.tenant.id}/admin/resend-verification`,
    );
    expect(res.status).toBe(500);
  });
});

describe("list and view tenants (R1.7)", () => {
  it("shows each tenant's state and usage, ordered by name", async () => {
    await createTenant("tn-al-grace", "grace@tenants-alnoor.test", {
      name: "Tenant tn-al-grace",
      subscription: {
        planId: basicId,
        startDate: addDays(today, -60),
        endDate: addDays(today, -1),
      },
    });
    await createTenant("tn-al-readonly", "readonly@tenants-alnoor.test", {
      name: "Tenant tn-al-readonly",
      subscription: {
        planId: basicId,
        startDate: addDays(today, -60),
        endDate: addDays(today, -15),
      },
    });
    const res = await as(omar).get("/operator/tenants");
    expect(res.status).toBe(200);
    const bySlug = Object.fromEntries(
      res.body.tenants.map((t: { tenant: { slug: string } }) => [t.tenant.slug, t]),
    );
    expect(bySlug["tn-al-noor"].subscription.state).toBe("active");
    expect(bySlug["tn-al-grace"].subscription.state).toBe("grace");
    expect(bySlug["tn-al-readonly"].subscription.state).toBe("read_only");
    expect(bySlug["tn-al-noor"].usage).toEqual({
      activeUsers: 1,
      userLimit: 10,
      overLimit: false,
      storage: { usedBytes: 0, limitBytes: 10 * 1024 ** 3, overLimit: false },
    });
    const names: string[] = res.body.tenants.map(
      (t: { tenant: { name: string } }) => t.tenant.name,
    );
    expect(names).toEqual(
      [...names].sort((a, b) => new Intl.Collator("und").compare(a.toLowerCase(), b.toLowerCase())),
    );
  });

  it("shows one tenant, and 404 for an unknown id or a non-UUID", async () => {
    const alNoor = await pool.query("select id from tenants where slug = 'tn-al-noor'");
    const res = await as(omar).get(`/operator/tenants/${alNoor.rows[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tenant: { slug: "tn-al-noor" },
      subscription: { pricing: { effectivePriceHalalas: 76_500 } },
      usage: { activeUsers: 1 },
    });
    expect(
      (await as(omar).get("/operator/tenants/00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
    expect((await as(omar).get("/operator/tenants/not-a-uuid")).status).toBe(404);
  });

  it("keeps Al-Noor's copied price when Omar later edits the plan (R1.2)", async () => {
    await as(omar).patch(`/operator/plans/${basicId}`, { priceHalalas: 120_000 });
    const alNoor = await pool.query("select id from tenants where slug = 'tn-al-noor'");
    const res = await as(omar).get(`/operator/tenants/${alNoor.rows[0].id}`);
    expect(res.body.subscription.pricing.priceHalalas).toBe(100_000);
    await as(omar).patch(`/operator/plans/${basicId}`, { priceHalalas: 100_000 });
  });
});

describe("seat check (R1.12)", () => {
  it("throws USER_LIMIT_REACHED when the tenant is already at its limit", async () => {
    const plan = await as(omar).post("/operator/plans", {
      name: "Tenants Solo",
      userLimit: 1,
      storageLimitGb: 10,
      graceDays: 0,
      priceHalalas: 0,
      paymentPeriod: "yearly",
    });
    const created = await createTenant("tn-al-solo", "solo@tenants-alnoor.test", {
      subscription: { planId: plan.body.plan.id, startDate: today, endDate: today },
    });
    expect(created.status).toBe(201);
    const db = createDb(pool);
    const err = await rejectionText(
      withTx(db, (tx) => assertSeatAvailable(tx, created.body.tenant.id)),
    );
    expect(err).toMatch(/USER_LIMIT_REACHED/);
  });
});

describe("tenant permissions (R1.15, R1.16)", () => {
  it("refuses a tenant user on every tenant route with 403", async () => {
    const alNoor = await pool.query("select id from tenants where slug = 'tn-al-noor'");
    const id = alNoor.rows[0].id;
    const responses = await Promise.all([
      as(tenantUser).post(
        "/operator/tenants",
        tenantBody("tn-al-sneaky", "sneaky@tenants-alnoor.test"),
      ),
      as(tenantUser).get("/operator/tenants"),
      as(tenantUser).get(`/operator/tenants/${id}`),
      as(tenantUser).post(`/operator/tenants/${id}/admin/resend-verification`),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(403);
    }
    expect((await request(app).get("/operator/tenants")).status).toBe(401);
  });
});
