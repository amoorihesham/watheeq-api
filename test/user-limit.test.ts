import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Tx } from "../src/db/pool.js";
import { withTx } from "../src/db/tx.js";
import { createLogger } from "../src/logging/logger.js";
import { assertSeatAvailable } from "../src/modules/subscriptions/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, rejectionText, seedUser } from "./helpers/db.js";

// Phase 2 adds the user-management API. These tests drive the seat check exactly as its "add user" and
// "reactivate user" paths will: assertSeatAvailable, then the write, in one transaction (Phase 1 spec, 4.1).

const PASSWORD = "correct horse battery staple";
const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger("silent"));

let omar = "";
let passwordHash = "";
let today = "";
let counter = 0;

const as = (access: string) => ({
  post: (path: string, body: object) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
});

const createPlan = async (name: string, userLimit: number): Promise<string> =>
  (
    await as(omar).post("/operator/plans", {
      name,
      userLimit,
      storageLimitGb: 10,
      graceDays: 14,
      priceHalalas: 100_000,
      paymentPeriod: "monthly",
    })
  ).body.data.id;

/** A tenant through the real API; its owner takes the first seat. */
async function createTenant(slug: string, planId: string): Promise<string> {
  const res = await as(omar).post("/operator/tenants", {
    name: `Tenant ${slug}`,
    slug,
    admin: { email: `owner@${slug}.test`, userName: "Owner" },
    subscription: { planId, startDate: today, endDate: today },
  });
  expect(res.status).toBe(201);
  return res.body.data.tenant.id;
}

/** Phase 2's "add user": the seat check, then the insert, in the caller's transaction. */
async function addMember(tx: Tx, tenantId: string, email: string): Promise<void> {
  await assertSeatAvailable(tx, tenantId);
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into users (email, user_name, password_hash, email_verified_at)
    values (${email}, ${email.split("@")[0]}, ${passwordHash}, now()) returning id`);
  await tx.execute(
    sql`insert into tenant_members (tenant_id, user_id, role_id)
        select ${tenantId}, ${rows[0]?.id}, id from roles where tenant_id = ${tenantId} and is_system`,
  );
}

const nextEmail = (slug: string) => `user${++counter}@${slug}.test`;
const add = (tenantId: string, slug: string) =>
  withTx(db, (tx) => addMember(tx, tenantId, nextEmail(slug)));

/** Phase 2's "reactivate user". */
const reactivate = (tenantId: string, email: string) =>
  withTx(db, async (tx) => {
    await assertSeatAvailable(tx, tenantId);
    await tx.execute(sql`update users set is_active = true where email = ${email}`);
  });

const setActive = (email: string, isActive: boolean) =>
  pool.query("update users set is_active = $2 where email = $1", [email, isActive]);

const activeMembers = async (tenantId: string): Promise<number> => {
  const { rows } = await pool.query(
    "select count(*)::int as n from tenant_members m join users u on u.id = m.user_id where m.tenant_id = $1 and u.is_active",
    [tenantId],
  );
  return rows[0].n;
};

/** Resolves after `ms`, or rejects if `promise` settles first: proves the promise is still waiting. */
const stillWaitingAfter = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(() => {
      throw new Error("expected the operation to be blocked");
    }),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  await seedUser(pool, { email: "omar@ul-watheeq.test", passwordHash, role: "operator" });
  omar = (await login(app, "omar@ul-watheeq.test", PASSWORD)).access;
  const { rows } = await pool.query(
    "select (now() at time zone 'Asia/Riyadh')::date::text as today",
  );
  today = rows[0].today;
});

afterAll(async () => {
  await pool.end();
});

describe("the user limit (R1.12)", () => {
  it("lets Al-Noor fill its seats, then refuses the next user with USER_LIMIT_REACHED", async () => {
    const plan = await createPlan("UL Three", 3);
    const tenant = await createTenant("ul-al-noor", plan);
    await add(tenant, "ul-al-noor");
    await add(tenant, "ul-al-noor");
    expect(await activeMembers(tenant)).toBe(3);
    expect(await rejectionText(add(tenant, "ul-al-noor"))).toMatch(/USER_LIMIT_REACHED/);
    expect(await activeMembers(tenant)).toBe(3);
  });

  it("makes a second transaction wait for the first's seat, then counts it and refuses", async () => {
    const plan = await createPlan("UL Two", 2);
    const tenant = await createTenant("ul-last-seat", plan);
    let releaseFirst: () => void = () => {};
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstHasSeat: () => void = () => {};
    const seatTaken = new Promise<void>((resolve) => {
      firstHasSeat = resolve;
    });

    // Admin A takes the last seat and keeps the transaction open.
    const first = withTx(db, async (tx) => {
      await addMember(tx, tenant, nextEmail("ul-last-seat"));
      firstHasSeat();
      await firstHolds;
    });
    await seatTaken;

    // Admin B tries for the same seat while A is still open: B must wait on the tenant's lock.
    const second = withTx(db, (tx) => addMember(tx, tenant, nextEmail("ul-last-seat")));
    await stillWaitingAfter(second, 300);

    releaseFirst();
    await first;
    expect(await rejectionText(second)).toMatch(/USER_LIMIT_REACHED/);
    expect(await activeMembers(tenant)).toBe(2);
  });

  it("gives the last seat to exactly one of many simultaneous additions", async () => {
    const plan = await createPlan("UL Five", 5);
    const tenant = await createTenant("ul-race", plan);
    await add(tenant, "ul-race");
    await add(tenant, "ul-race");
    await add(tenant, "ul-race");
    // Open the connections first: otherwise the first transaction finishes on an idle connection while the
    // others are still connecting, and the attempts never actually overlap.
    const warm = await Promise.all(Array.from({ length: 5 }, () => pool.connect()));
    for (const client of warm) {
      client.release();
    }
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => add(tenant, "ul-race")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await activeMembers(tenant)).toBe(5);
  });

  it("refuses to reactivate a user when the tenant is at its limit", async () => {
    const plan = await createPlan("UL Reactivate", 2);
    const tenant = await createTenant("ul-reactivate", plan);
    const leaver = nextEmail("ul-reactivate");
    await withTx(db, (tx) => addMember(tx, tenant, leaver));
    await setActive(leaver, false);
    await add(tenant, "ul-reactivate");

    expect(await rejectionText(reactivate(tenant, leaver))).toMatch(/USER_LIMIT_REACHED/);
    const { rows } = await pool.query("select is_active from users where email = $1", [leaver]);
    expect(rows[0].is_active).toBe(false);
  });

  it("never makes Al-Rashid wait for Al-Noor's lock", async () => {
    const plan = await createPlan("UL Isolation", 10);
    const alNoor = await createTenant("ul-iso-noor", plan);
    const alRashid = await createTenant("ul-iso-rashid", plan);
    let release: () => void = () => {};
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const noorTx = withTx(db, async (tx) => {
      await addMember(tx, alNoor, nextEmail("ul-iso-noor"));
      locked();
      await holding;
    });
    try {
      await isLocked;
      // Al-Noor's lock is held until release(), so Al-Rashid finishing at all proves it never waited for it.
      // The bound turns a wrongly shared lock into a clear failure instead of a hang.
      const outcome = await Promise.race([
        add(alRashid, "ul-iso-rashid").then(() => "added"),
        new Promise((resolve) => setTimeout(resolve, 5000, "blocked")),
      ]);
      expect(outcome).toBe("added");
    } finally {
      release();
      await noorTx;
    }
  });
});

describe("a downgrade below the user count (R1.13, D15)", () => {
  it("keeps existing users working, blocks new ones, and allows them again once within the limit", async () => {
    const big = await createPlan("UL Big", 10);
    const small = await createPlan("UL Small", 2);
    const tenant = await createTenant("ul-al-rashid", big);
    const members = [
      nextEmail("ul-al-rashid"),
      nextEmail("ul-al-rashid"),
      nextEmail("ul-al-rashid"),
    ];
    for (const email of members) {
      await withTx(db, (tx) => addMember(tx, tenant, email));
    }
    expect(await activeMembers(tenant)).toBe(4);

    const downgrade = await as(omar).put(`/operator/tenants/${tenant}/subscription`, {
      planId: small,
      startDate: today,
      endDate: today,
      reason: "Downgraded to Small",
    });
    expect(downgrade.status).toBe(200);
    expect(downgrade.body.data.usage).toEqual({
      activeUsers: 4,
      userLimit: 2,
      overLimit: true,
      storage: { usedBytes: 0, limitBytes: 10 * 1024 ** 3, overLimit: false },
    });

    // Nobody is removed: every existing user still logs in.
    for (const email of members) {
      expect((await login(app, email, PASSWORD)).res.status).toBe(200);
    }
    expect(await activeMembers(tenant)).toBe(4);

    expect(await rejectionText(add(tenant, "ul-al-rashid"))).toMatch(/USER_LIMIT_REACHED/);
    await setActive(members[0] ?? "", false);
    await setActive(members[1] ?? "", false);
    // 2 active on a limit of 2: still full.
    expect(await rejectionText(add(tenant, "ul-al-rashid"))).toMatch(/USER_LIMIT_REACHED/);
    await setActive(members[2] ?? "", false);
    await add(tenant, "ul-al-rashid");
    expect(await activeMembers(tenant)).toBe(2);
  });

  it("makes a downgrade wait for an addition in progress, and reports the result including it", async () => {
    const big = await createPlan("UL Big Two", 10);
    const small = await createPlan("UL Small Two", 1);
    const tenant = await createTenant("ul-interleave", big);
    let release: () => void = () => {};
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    let added: () => void = () => {};
    const isAdded = new Promise<void>((resolve) => {
      added = resolve;
    });
    const addition = withTx(db, async (tx) => {
      await addMember(tx, tenant, nextEmail("ul-interleave"));
      added();
      await holding;
    });
    await isAdded;

    const downgrade = as(omar)
      .put(`/operator/tenants/${tenant}/subscription`, {
        planId: small,
        startDate: today,
        endDate: today,
      })
      .then((res) => res);
    await stillWaitingAfter(downgrade, 300);

    release();
    await addition;
    expect((await downgrade).body.data.usage).toEqual({
      activeUsers: 2,
      userLimit: 1,
      overLimit: true,
      storage: { usedBytes: 0, limitBytes: 10 * 1024 ** 3, overLimit: false },
    });
  });
});
