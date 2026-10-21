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
let sara = "";

const basic = {
  name: "Plans Basic",
  userLimit: 10,
  graceDays: 14,
  priceHalalas: 100_000,
  paymentPeriod: "monthly",
  discountPercent: 15,
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  omarId = await seedUser(pool, {
    email: "omar@plans-watheeq.test",
    passwordHash,
    role: "operator",
  });
  await seedTenant(pool, "plans-al-noor", [{ email: "sara@plans-alnoor.test", passwordHash }]);
  omar = (await login(app, "omar@plans-watheeq.test", PASSWORD)).access;
  sara = (await login(app, "sara@plans-alnoor.test", PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

const as = (access: string) => ({
  post: (path: string, body: object) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
});

const auditFor = async (planId: string) => {
  const { rows } = await pool.query(
    "select tenant_id, actor_type, actor_id, action, details from audit_log where resource_id = $1 order by id",
    [planId],
  );
  return rows;
};

describe("create a plan (R1.1, R1.14)", () => {
  it("creates Basic with price, payment period, and discount, and audits it at platform level", async () => {
    const res = await as(omar).post("/operator/plans", basic);
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.plan).toMatchObject(basic);
    expect(res.body.plan.id).toMatch(/^[0-9a-f-]{36}$/);

    const audit = await auditFor(res.body.plan.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenant_id: null,
      actor_type: "operator",
      actor_id: omarId,
      action: "plan.created",
      details: { after: { name: "Plans Basic", priceHalalas: 100_000, discountPercent: 15 } },
    });
  });

  it("defaults the discount to 0 and keeps two-decimal discounts exact", async () => {
    const free = await as(omar).post("/operator/plans", {
      ...basic,
      name: "Plans No Discount",
      discountPercent: undefined,
    });
    expect(free.body.plan.discountPercent).toBe(0);
    const half = await as(omar).post("/operator/plans", {
      ...basic,
      name: "Plans Yearly",
      paymentPeriod: "yearly",
      priceHalalas: 1_100_000,
      discountPercent: 12.5,
    });
    expect(half.status).toBe(201);
    expect(half.body.plan).toMatchObject({ paymentPeriod: "yearly", discountPercent: 12.5 });
  });

  it("refuses a duplicate name in any case with 409 PLAN_NAME_TAKEN, leaving no audit row", async () => {
    const res = await as(omar).post("/operator/plans", { ...basic, name: "  plans basic " });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_NAME_TAKEN");
    const { rows } = await pool.query(
      "select count(*)::int as n from audit_log where action = 'plan.created' and details->'after'->>'name' = 'plans basic'",
    );
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ["a negative price", { priceHalalas: -1 }, "priceHalalas"],
    ["a fractional price", { priceHalalas: 10.5 }, "priceHalalas"],
    ["a price over 1,000,000 SAR", { priceHalalas: 100_000_001 }, "priceHalalas"],
    ["an unknown payment period", { paymentPeriod: "weekly" }, "paymentPeriod"],
    ["a discount over 100", { discountPercent: 101 }, "discountPercent"],
    ["a negative discount", { discountPercent: -1 }, "discountPercent"],
    ["a discount with three decimals", { discountPercent: 12.345 }, "discountPercent"],
    ["a zero user limit", { userLimit: 0 }, "userLimit"],
    ["a grace period over 365 days", { graceDays: 366 }, "graceDays"],
    ["a blank name", { name: "   " }, "name"],
  ])("rejects %s with 400", async (_label, change, path) => {
    const res = await as(omar).post("/operator/plans", {
      ...basic,
      name: `Plans ${_label}`,
      ...change,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it("rejects a missing required field", async () => {
    const { priceHalalas: _omitted, ...withoutPrice } = basic;
    const res = await as(omar).post("/operator/plans", { ...withoutPrice, name: "Plans Missing" });
    expect(res.status).toBe(400);
  });
});

describe("list and view plans", () => {
  it("lists plans ordered by name, ignoring case", async () => {
    await as(omar).post("/operator/plans", { ...basic, name: "plans aaa lowercase" });
    const res = await as(omar).get("/operator/plans");
    expect(res.status).toBe(200);
    const names: string[] = res.body.plans.map((p: { name: string }) => p.name);
    const sorted = [...names].sort((a, b) =>
      new Intl.Collator("und").compare(a.toLowerCase(), b.toLowerCase()),
    );
    expect(names).toEqual(sorted);
  });

  it("returns one plan, and 404 for an unknown id or a non-UUID", async () => {
    const created = await as(omar).post("/operator/plans", { ...basic, name: "Plans View" });
    const res = await as(omar).get(`/operator/plans/${created.body.plan.id}`);
    expect(res.status).toBe(200);
    expect(res.body.plan.name).toBe("Plans View");
    expect(
      (await as(omar).get("/operator/plans/00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
    expect((await as(omar).get("/operator/plans/not-a-uuid")).status).toBe(404);
  });
});

describe("edit a plan (R1.1, R1.14)", () => {
  it("changes price and discount and audits before and after", async () => {
    const created = await as(omar).post("/operator/plans", { ...basic, name: "Plans Edit" });
    const id = created.body.plan.id;
    const res = await as(omar).patch(`/operator/plans/${id}`, {
      priceHalalas: 120_000,
      discountPercent: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({
      priceHalalas: 120_000,
      discountPercent: 10,
      userLimit: 10,
    });
    expect(new Date(res.body.plan.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.body.plan.updatedAt).getTime(),
    );

    const audit = await auditFor(id);
    expect(audit.map((a) => a.action)).toEqual(["plan.created", "plan.updated"]);
    expect(audit[1]).toMatchObject({
      tenant_id: null,
      actor_id: omarId,
      details: {
        before: { priceHalalas: 100_000, discountPercent: 15 },
        after: { priceHalalas: 120_000, discountPercent: 10 },
      },
    });
  });

  it("refuses renaming to an existing name, an empty change, invalid values, and unknown ids", async () => {
    const created = await as(omar).post("/operator/plans", { ...basic, name: "Plans Rename" });
    const id = created.body.plan.id;
    const taken = await as(omar).patch(`/operator/plans/${id}`, { name: "PLANS BASIC" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("PLAN_NAME_TAKEN");
    expect((await as(omar).patch(`/operator/plans/${id}`, {})).status).toBe(400);
    expect((await as(omar).patch(`/operator/plans/${id}`, { discountPercent: 100.5 })).status).toBe(
      400,
    );
    expect(
      (
        await as(omar).patch("/operator/plans/00000000-0000-4000-8000-000000000000", {
          graceDays: 1,
        })
      ).status,
    ).toBe(404);
    expect((await as(omar).patch("/operator/plans/not-a-uuid", { graceDays: 1 })).status).toBe(404);
    expect((await auditFor(id)).map((a) => a.action)).toEqual(["plan.created"]);
  });
});

describe("plan permissions (R1.15, R1.16)", () => {
  it("refuses a tenant user on every plan route with 403, and an anonymous caller with 401", async () => {
    const created = await as(omar).post("/operator/plans", { ...basic, name: "Plans Guarded" });
    const id = created.body.plan.id;
    const responses = await Promise.all([
      as(sara).post("/operator/plans", { ...basic, name: "Plans Sara" }),
      as(sara).get("/operator/plans"),
      as(sara).get(`/operator/plans/${id}`),
      as(sara).patch(`/operator/plans/${id}`, { graceDays: 1 }),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await request(app).get("/operator/plans")).status).toBe(401);
  });
});
