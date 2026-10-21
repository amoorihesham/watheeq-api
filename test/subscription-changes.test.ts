import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, seedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let omar = "";
let omarId = "";
let tenantUser = "";
let basicId = "";
let professionalId = "";
let today = "";

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const as = (access: string) => ({
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
});

/** Creates a tenant on Basic with a 10% customer discount and returns its id. */
async function createTenant(slug: string): Promise<string> {
  const res = await as(omar).post("/operator/tenants", {
    name: `Tenant ${slug}`,
    slug,
    admin: { email: `admin@${slug}.test`, userName: "Sara Al-Qahtani" },
    subscription: {
      planId: basicId,
      startDate: today,
      endDate: addDays(today, 364),
      customerDiscountPercent: 10,
    },
  });
  expect(res.status).toBe(201);
  return res.body.tenant.id;
}

const change = (tenantId: string, body: object) =>
  as(omar).put(`/operator/tenants/${tenantId}/subscription`, body);

const changesOf = async (tenantId: string) => {
  const { rows } = await pool.query(
    "select actor_id, reason, details from audit_log where action = 'subscription.changed' and tenant_id = $1 order by id",
    [tenantId],
  );
  return rows;
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  omarId = await seedUser(pool, { email: "omar@sc-watheeq.test", passwordHash, role: "operator" });
  await seedTenant(pool, "sc-existing", [{ email: "khalid@sc-alrashid.test", passwordHash }]);
  omar = (await login(app, "omar@sc-watheeq.test", PASSWORD)).access;
  tenantUser = (await login(app, "khalid@sc-alrashid.test", PASSWORD)).access;
  const plan = (body: object) => as(omar).post("/operator/plans", body);
  basicId = (
    await plan({
      name: "SC Basic",
      userLimit: 10,
      graceDays: 14,
      priceHalalas: 100_000,
      paymentPeriod: "monthly",
      discountPercent: 15,
    })
  ).body.plan.id;
  professionalId = (
    await plan({
      name: "SC Professional",
      userLimit: 50,
      graceDays: 30,
      priceHalalas: 1_100_000,
      paymentPeriod: "yearly",
      discountPercent: 0,
    })
  ).body.plan.id;
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
});

afterAll(async () => {
  await pool.end();
});

describe("change a subscription (R1.6)", () => {
  it("moves Al-Noor to Professional, copying its current terms and keeping the customer discount", async () => {
    const id = await createTenant("sc-al-noor");
    const res = await change(id, {
      planId: professionalId,
      startDate: today,
      endDate: "2028-10-31",
      reason: "Upgraded after a sales call",
    });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      subscription: {
        planId: professionalId,
        planName: "SC Professional",
        userLimit: 50,
        graceDays: 30,
        startDate: today,
        endDate: "2028-10-31",
        graceEndsOn: "2028-11-30",
        state: "active",
        pricing: {
          priceHalalas: 1_100_000,
          paymentPeriod: "yearly",
          planDiscountPercent: 0,
          customerDiscountPercent: 10,
          effectivePriceHalalas: 990_000,
        },
      },
      usage: { activeUsers: 1, userLimit: 50, overLimit: false },
    });

    const [entry] = await changesOf(id);
    expect(entry).toMatchObject({
      actor_id: omarId,
      reason: "Upgraded after a sales call",
      details: {
        before: {
          planName: "SC Basic",
          userLimit: 10,
          priceHalalas: 100_000,
          endDate: addDays(today, 364),
        },
        after: {
          planName: "SC Professional",
          userLimit: 50,
          priceHalalas: 1_100_000,
          endDate: "2028-10-31",
        },
      },
    });
  });

  it("replaces the customer discount when one is sent", async () => {
    const id = await createTenant("sc-discount");
    const res = await change(id, {
      planId: basicId,
      startDate: today,
      endDate: addDays(today, 364),
      customerDiscountPercent: 0,
    });
    expect(res.body.subscription.pricing).toMatchObject({
      customerDiscountPercent: 0,
      effectivePriceHalalas: 85_000,
    });
  });

  it("copies the plan's terms as they are at the change, not at assignment (D14)", async () => {
    const id = await createTenant("sc-recopy");
    await as(omar).patch(`/operator/plans/${basicId}`, { priceHalalas: 120_000 });
    const before = await as(omar).get(`/operator/tenants/${id}`);
    expect(before.body.subscription.pricing.priceHalalas).toBe(100_000);
    const res = await change(id, {
      planId: basicId,
      startDate: today,
      endDate: addDays(today, 364),
    });
    expect(res.body.subscription.pricing.priceHalalas).toBe(120_000);
    await as(omar).patch(`/operator/plans/${basicId}`, { priceHalalas: 100_000 });
  });

  it("is not changed by a later plan edit (R1.2)", async () => {
    const id = await createTenant("sc-frozen");
    await change(id, { planId: professionalId, startDate: today, endDate: addDays(today, 364) });
    await as(omar).patch(`/operator/plans/${professionalId}`, { userLimit: 5, priceHalalas: 1 });
    const res = await as(omar).get(`/operator/tenants/${id}`);
    expect(res.body.subscription).toMatchObject({
      userLimit: 50,
      pricing: { priceHalalas: 1_100_000 },
    });
    await as(omar).patch(`/operator/plans/${professionalId}`, {
      userLimit: 50,
      priceHalalas: 1_100_000,
    });
  });
});

describe("end early and renew (R1.8)", () => {
  it("ends a subscription early with a past end date, then renewal makes it Active on the next request", async () => {
    const id = await createTenant("sc-renew");
    const ended = await change(id, {
      planId: basicId,
      startDate: addDays(today, -60),
      endDate: addDays(today, -20),
      reason: "Contract terminated",
    });
    expect(ended.status).toBe(200);
    expect(ended.body.subscription.state).toBe("read_only");
    expect((await as(omar).get(`/operator/tenants/${id}`)).body.subscription.state).toBe(
      "read_only",
    );

    const renewed = await change(id, {
      planId: basicId,
      startDate: today,
      endDate: addDays(today, 364),
      reason: "Renewed",
    });
    expect(renewed.body.subscription.state).toBe("active");
    expect((await as(omar).get(`/operator/tenants/${id}`)).body.subscription.state).toBe("active");
    expect((await changesOf(id)).map((c) => c.reason)).toEqual(["Contract terminated", "Renewed"]);
  });
});

describe("validation", () => {
  it.each([
    [
      "a start date in the future",
      { startDate: "2999-01-01", endDate: "2999-12-31" },
      "startDate",
      "in_future",
    ],
    ["an end date before the start date", { endDate: "2000-01-01" }, "endDate", "custom"],
    [
      "an unknown plan",
      { planId: "00000000-0000-4000-8000-000000000000" },
      "planId",
      "unknown_plan",
    ],
    [
      "a customer discount with three decimals",
      { customerDiscountPercent: 12.345 },
      "customerDiscountPercent",
      "custom",
    ],
    ["a reason over 500 characters", { reason: "x".repeat(501) }, "reason", "too_big"],
  ])("rejects %s with 400 and changes nothing", async (_label, override, path, code) => {
    const id = await createTenant(`sc-bad-${path.toLowerCase()}`);
    const res = await change(id, {
      planId: professionalId,
      startDate: today,
      endDate: addDays(today, 30),
      ...override,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ path, code });
    expect(await changesOf(id)).toHaveLength(0);
  });

  it("answers 404 for an unknown tenant and a non-UUID", async () => {
    const body = { planId: basicId, startDate: today, endDate: today };
    expect((await change("00000000-0000-4000-8000-000000000000", body)).status).toBe(404);
    expect((await change("not-a-uuid", body)).status).toBe(404);
  });

  it("refuses a tenant user with 403 (R1.16)", async () => {
    const id = await createTenant("sc-guarded");
    const res = await as(tenantUser).put(`/operator/tenants/${id}/subscription`, {
      planId: professionalId,
      startDate: today,
      endDate: today,
    });
    expect(res.status).toBe(403);
    expect(await changesOf(id)).toHaveLength(0);
  });
});

describe("concurrent changes (R1.5)", () => {
  it("waits while another transaction holds the tenant's seat lock, then applies", async () => {
    const id = await createTenant("sc-locked");
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
      let done = false;
      const pending = change(id, { planId: professionalId, startDate: today, endDate: today }).then(
        (res) => {
          done = true;
          return res;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done).toBe(false);
      await holder.query("commit");
      expect((await pending).status).toBe(200);
    } finally {
      holder.release();
    }
  });

  it("applies two simultaneous changes one after the other, each audited against the other's result", async () => {
    const id = await createTenant("sc-race");
    const [a, b] = await Promise.all([
      change(id, { planId: professionalId, startDate: today, endDate: "2028-01-31" }),
      change(id, { planId: basicId, startDate: today, endDate: "2029-01-31" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const [first, second] = await changesOf(id);
    expect(second.details.before).toEqual(first.details.after);
    const current = await as(omar).get(`/operator/tenants/${id}`);
    expect(current.body.subscription.endDate).toBe(second.details.after.endDate);
    const { rows } = await pool.query(
      "select count(*)::int as n from subscriptions where tenant_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(1);
  });
});
