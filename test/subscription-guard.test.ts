import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { createLogger } from "../src/logging/logger.js";
import { authenticate, requireRole } from "../src/modules/auth/index.js";
import {
  requireActiveSubscription,
  subscriptionGuard,
} from "../src/modules/subscriptions/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login, refreshCookie } from "./helpers/auth.js";
import { TEST_JWT_SECRET } from "./helpers/config.js";
import { connectToTestDb, MEMBER_ROLE, seedRole, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@sg-alnoor.test";
const pool = connectToTestDb();
const db = createDb(pool);

// Test-only tenant routes, guarded exactly as later phases' tenant routers will be.
const tenantRoutes = express.Router();
tenantRoutes.use(
  "/tenant-thing",
  authenticate(TEST_JWT_SECRET),
  requireRole("user"),
  subscriptionGuard(db),
);
const ok: express.RequestHandler = (_req, res) => {
  res.status(200).json({ ok: true });
};
tenantRoutes.get("/tenant-thing", ok);
tenantRoutes.post("/tenant-thing", ok);
tenantRoutes.put("/tenant-thing", ok);
tenantRoutes.patch("/tenant-thing", ok);
tenantRoutes.delete("/tenant-thing", ok);
// Like Phase 6's request submission: allowed only while Active (R1.10).
tenantRoutes.post("/tenant-thing/submit", requireActiveSubscription(), ok);

const app = testApp(pool, createLogger("silent"), { routers: [tenantRoutes] });

let omar = "";
let sara = "";
let tenantId = "";
let basicId = "";
let today = "";

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Moves Al-Noor's subscription into a state by setting its end date (14 grace days). */
async function setState(state: "active" | "grace" | "read_only") {
  const endDate = {
    active: addDays(today, 30),
    grace: addDays(today, -1),
    read_only: addDays(today, -15),
  }[state];
  await pool.query("update subscriptions set start_date = $2, end_date = $3 where tenant_id = $1", [
    tenantId,
    addDays(today, -60),
    endDate,
  ]);
}

const asSara = {
  send: (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
    request(app)[method](path).set("Cookie", accessCookie(sara)).send({}),
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(sara)),
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await seedUser(pool, { email: "omar@sg-watheeq.test", passwordHash, role: "operator" });
  omar = (await login(app, "omar@sg-watheeq.test", PASSWORD)).access;
  basicId = (
    await request(app).post("/operator/plans").set("Cookie", accessCookie(omar)).send({
      name: "SG Basic",
      userLimit: 10,
      graceDays: 14,
      priceHalalas: 100_000,
      paymentPeriod: "monthly",
      discountPercent: 15,
    })
  ).body.plan.id;
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
  const created = await request(app)
    .post("/operator/tenants")
    .set("Cookie", accessCookie(omar))
    .send({
      name: "Al-Noor",
      slug: "sg-al-noor",
      admin: { email: SARA, userName: "Sara Al-Qahtani" },
      subscription: {
        planId: basicId,
        startDate: today,
        endDate: addDays(today, 30),
        customerDiscountPercent: 10,
      },
    });
  tenantId = created.body.tenant.id;
  // Stands in for Sara following her verification link (covered in tenants.test.ts).
  await pool.query(
    "update users set password_hash = $2, email_verified_at = now() where email = $1",
    [SARA, passwordHash],
  );
  sara = (await login(app, SARA, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("Active", () => {
  it("allows reads, writes, and Active-only routes", async () => {
    await setState("active");
    expect((await asSara.get("/tenant-thing")).status).toBe(200);
    expect((await asSara.send("post", "/tenant-thing")).status).toBe(200);
    expect((await asSara.send("post", "/tenant-thing/submit")).status).toBe(200);
  });
});

describe("Grace (R1.10)", () => {
  it("allows ordinary writes but refuses Active-only routes with SUBSCRIPTION_NOT_ACTIVE", async () => {
    await setState("grace");
    expect((await asSara.send("post", "/tenant-thing")).status).toBe(200);
    const submit = await asSara.send("post", "/tenant-thing/submit");
    expect(submit.status).toBe(403);
    expect(submit.body.error.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
  });
});

describe("Read-only (R1.9)", () => {
  it("allows reads", async () => {
    await setState("read_only");
    expect((await asSara.get("/tenant-thing")).status).toBe(200);
    expect((await asSara.get("/subscription")).status).toBe(200);
  });

  it.each(["post", "put", "patch", "delete"] as const)(
    "refuses %s with SUBSCRIPTION_READ_ONLY",
    async (method) => {
      await setState("read_only");
      const res = await asSara.send(method, "/tenant-thing");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    },
  );

  it("still lets Sara log in, refresh, and log out", async () => {
    await setState("read_only");
    const session = await login(app, SARA, PASSWORD);
    expect(session.res.status).toBe(200);
    const refreshed = await request(app)
      .post("/auth/refresh")
      .set("Cookie", refreshCookie(session.refresh));
    expect(refreshed.status).toBe(200);
    const fresh = await login(app, SARA, PASSWORD);
    const logout = await request(app)
      .post("/auth/logout")
      .set("Cookie", refreshCookie(fresh.refresh));
    expect(logout.status).toBe(204);
  });

  it("is lifted on Sara's very next request after Omar renews (R1.8)", async () => {
    await setState("read_only");
    expect((await asSara.send("post", "/tenant-thing")).status).toBe(403);
    const renewed = await request(app)
      .put(`/operator/tenants/${tenantId}/subscription`)
      .set("Cookie", accessCookie(omar))
      .send({ planId: basicId, startDate: today, endDate: addDays(today, 364), reason: "Renewed" });
    expect(renewed.body.subscription.state).toBe("active");
    // Same access token as before: the guard reads the subscription on every request.
    expect((await asSara.send("post", "/tenant-thing")).status).toBe(200);
  });
});

describe("the guard itself", () => {
  it("refuses an operator, who has no tenant, and an anonymous caller", async () => {
    const asOmar = await request(app).get("/tenant-thing").set("Cookie", accessCookie(omar));
    expect(asOmar.status).toBe(403);
    expect((await request(app).get("/tenant-thing")).status).toBe(401);
  });
});

describe("GET /auth/me (R1.11)", () => {
  it("tells every tenant user the subscription state, end date, and grace end", async () => {
    await setState("grace");
    const res = await asSara.get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.subscription).toEqual({
      state: "grace",
      endDate: addDays(today, -1),
      graceEndsOn: addDays(today, 13),
    });
    expect(res.body.user.tenant.id).toBe(tenantId);
  });

  it("returns subscription null for an operator", async () => {
    const res = await request(app).get("/auth/me").set("Cookie", accessCookie(omar));
    expect(res.body.subscription).toBeNull();
  });
});

describe("GET /subscription (R1.11, P1.23)", () => {
  it("shows Sara every field of Al-Noor's subscription and its usage", async () => {
    await setState("active");
    const res = await asSara.get("/subscription");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      subscription: {
        planId: basicId,
        planName: "SG Basic",
        userLimit: 10,
        graceDays: 14,
        startDate: addDays(today, -60),
        endDate: addDays(today, 30),
        graceEndsOn: addDays(today, 44),
        state: "active",
        pricing: {
          priceHalalas: 100_000,
          paymentPeriod: "monthly",
          planDiscountPercent: 15,
          customerDiscountPercent: 10,
          effectivePriceHalalas: 76_500,
        },
      },
      usage: { activeUsers: 1, userLimit: 10, overLimit: false },
    });
  });

  it("refuses a member with 403: subscription.view is held by admins (Phase 2 spec, 4.2)", async () => {
    await setState("active");
    const passwordHash = await hashPassword(PASSWORD);
    const khalidId = await seedUser(pool, { email: "khalid@sg-alnoor.test", passwordHash });
    const memberRoleId = await seedRole(pool, tenantId, MEMBER_ROLE);
    await pool.query(
      "insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
      [tenantId, khalidId, memberRoleId],
    );
    const khalid = (await login(app, "khalid@sg-alnoor.test", PASSWORD)).access;
    const res = await request(app).get("/subscription").set("Cookie", accessCookie(khalid));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect((await request(app).get("/auth/me").set("Cookie", accessCookie(khalid))).status).toBe(
      200,
    );
  });

  it("refuses an operator with 403 and an anonymous caller with 401", async () => {
    expect((await request(app).get("/subscription").set("Cookie", accessCookie(omar))).status).toBe(
      403,
    );
    expect((await request(app).get("/subscription")).status).toBe(401);
  });
});
