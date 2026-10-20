import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuditContext, audit, platformAudit } from "../src/audit/index.js";
import { withPlatformTx } from "../src/db/platform-tx.js";
import { createDb } from "../src/db/pool.js";
import { auditLog, tenants, users } from "../src/db/schema/index.js";
import { withTenantTx } from "../src/db/tenant-tx.js";
import { connectAsAdmin, connectAsApp, rejectionText, seedTenant } from "./helpers/db.js";

const NO_CONTEXT = /tenant context is not set/;
const RLS_REJECTED = /row-level security policy/;

describe("platform access (real PostgreSQL, connected as watheeq_app)", () => {
  // One connection, so platform and tenant transactions share it and a leaked setting would show.
  const appPool = connectAsApp();
  appPool.options.max = 1;
  const db = createDb(appPool);
  const adminPool = connectAsAdmin(1);

  let alNoor = "";
  let alRashid = "";
  let saraId = "";
  let omarId = "";

  const operatorCtx = (): AuditContext => ({
    actor: { type: "operator", id: omarId },
    requestId: "req-platform",
  });

  beforeAll(async () => {
    const noor = await seedTenant(adminPool, "PA Al-Noor", [{ email: "pa-sara@alnoor.test" }]);
    alNoor = noor.id;
    saraId = noor.userIds[0] ?? "";
    alRashid = (await seedTenant(adminPool, "PA Al-Rashid", [{ email: "pa-khalid@alrashid.test" }]))
      .id;
    const op = await adminPool.query<{ id: string }>(
      "insert into operators (email, password_hash) values ('pa-omar@watheeq.test', 'x') returning id",
    );
    omarId = op.rows[0]?.id ?? "";
  });

  afterAll(async () => {
    await Promise.all([appPool.end(), adminPool.end()]);
  });

  describe("a platform transaction", () => {
    it("sees every tenant and every tenant's users", async () => {
      await withPlatformTx(db, async (tx) => {
        const tenantIds = (await tx.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
        expect(tenantIds).toEqual(expect.arrayContaining([alNoor, alRashid]));
        const emails = (await tx.select({ email: users.email }).from(users)).map((u) => u.email);
        expect(emails).toEqual(
          expect.arrayContaining(["pa-sara@alnoor.test", "pa-khalid@alrashid.test"]),
        );
      });
    });

    it("can create a tenant and a user in it", async () => {
      const created = await withPlatformTx(db, async (tx) => {
        const [tenant] = await tx.insert(tenants).values({ name: "PA Al-Fajr" }).returning();
        const [user] = await tx
          .insert(users)
          .values({ tenantId: tenant?.id ?? "", email: "pa-admin@alfajr.test", passwordHash: "x" })
          .returning();
        return { tenantId: tenant?.id ?? "", userTenantId: user?.tenantId };
      });
      expect(created.userTenantId).toBe(created.tenantId);
      const seen = await withTenantTx(db, created.tenantId, (tx) => tx.select().from(tenants));
      expect(seen.map((t) => t.name)).toEqual(["PA Al-Fajr"]);
    });

    it("writes platform-level and tenant audit entries, and reads both", async () => {
      await withPlatformTx(db, async (tx) => {
        await platformAudit(tx, operatorCtx(), {
          tenantId: null,
          action: "plan.created",
          resourceType: "plan",
          resourceId: "pa-plan-1",
        });
        await platformAudit(tx, operatorCtx(), {
          tenantId: alNoor,
          action: "subscription.changed",
          resourceType: "subscription",
          resourceId: alNoor,
        });
      });

      const rows = await withPlatformTx(db, (tx) =>
        tx.select().from(auditLog).where(eq(auditLog.requestId, "req-platform")),
      );
      expect(rows.map((r) => [r.action, r.tenantId, r.actorType, r.actorId]).sort()).toEqual([
        ["plan.created", null, "operator", omarId],
        ["subscription.changed", alNoor, "operator", omarId],
      ]);
    });

    it("leaves no platform setting behind on the pooled connection", async () => {
      await withPlatformTx(db, (tx) => tx.select().from(tenants));
      expect(await rejectionText(db.select().from(tenants))).toMatch(NO_CONTEXT);
      const visible = await db.transaction(async (tx) => {
        const r = await tx.execute<{ on: boolean }>(sql`select app_platform_context() as on`);
        return r.rows[0]?.on;
      });
      expect(visible).toBe(false);
    });

    it("still cannot update or delete audit entries", async () => {
      const upd = await rejectionText(
        withPlatformTx(db, (tx) => tx.update(auditLog).set({ reason: "tampered" })),
      );
      expect(upd).toMatch(/permission denied/);
      const del = await rejectionText(withPlatformTx(db, (tx) => tx.delete(auditLog)));
      expect(del).toMatch(/permission denied/);
    });

    it("cannot delete tenants or users", async () => {
      expect(await rejectionText(withPlatformTx(db, (tx) => tx.delete(users)))).toMatch(
        /permission denied/,
      );
      expect(await rejectionText(withPlatformTx(db, (tx) => tx.delete(tenants)))).toMatch(
        /permission denied/,
      );
    });
  });

  describe("a tenant transaction", () => {
    it("sees only its own tenant, users, and audit entries, never platform-level ones", async () => {
      await withPlatformTx(db, (tx) =>
        platformAudit(tx, operatorCtx(), {
          tenantId: null,
          action: "plan.updated",
          resourceType: "plan",
          resourceId: "pa-plan-2",
        }),
      );
      await withTenantTx(db, alNoor, async (tx) => {
        expect((await tx.select().from(tenants)).map((t) => t.id)).toEqual([alNoor]);
        expect((await tx.select().from(users)).every((u) => u.tenantId === alNoor)).toBe(true);
        const entries = await tx.select().from(auditLog);
        expect(entries.every((e) => e.tenantId === alNoor)).toBe(true);
        expect(entries.some((e) => e.action === "subscription.changed")).toBe(true);
      });
    });

    it("cannot create a tenant, even one with its own id", async () => {
      expect(
        await rejectionText(
          withTenantTx(db, alNoor, (tx) => tx.insert(tenants).values({ name: "X" })),
        ),
      ).toMatch(RLS_REJECTED);
      expect(
        await rejectionText(
          withTenantTx(db, alNoor, (tx) => tx.insert(tenants).values({ id: alNoor, name: "X" })),
        ),
      ).toMatch(RLS_REJECTED);
    });

    it("cannot write a platform-level audit entry", async () => {
      const err = await rejectionText(
        withTenantTx(db, alNoor, (tx) =>
          platformAudit(tx, operatorCtx(), {
            tenantId: null,
            action: "plan.created",
            resourceType: "plan",
            resourceId: "forged",
          }),
        ),
      );
      expect(err).toMatch(RLS_REJECTED);
    });

    it("cannot write another tenant's audit entry or user", async () => {
      const auditErr = await rejectionText(
        withTenantTx(db, alNoor, (tx) =>
          platformAudit(tx, operatorCtx(), {
            tenantId: alRashid,
            action: "x.y",
            resourceType: "x",
            resourceId: "1",
          }),
        ),
      );
      expect(auditErr).toMatch(RLS_REJECTED);
      const userErr = await rejectionText(
        withTenantTx(db, alNoor, (tx) =>
          tx.insert(users).values({ tenantId: alRashid, email: "pa-x@x.test", passwordHash: "x" }),
        ),
      );
      expect(userErr).toMatch(RLS_REJECTED);
    });

    it("still fails without a tenant context (R0.8)", async () => {
      expect(await rejectionText(db.select().from(users))).toMatch(NO_CONTEXT);
      expect(await rejectionText(db.select().from(tenants))).toMatch(NO_CONTEXT);
      expect(await rejectionText(db.select().from(auditLog))).toMatch(NO_CONTEXT);
      const err = await rejectionText(
        db.transaction((tx) =>
          platformAudit(tx, operatorCtx(), {
            tenantId: null,
            action: "plan.created",
            resourceType: "plan",
            resourceId: "forged",
          }),
        ),
      );
      expect(err).toMatch(NO_CONTEXT);
    });

    it("still writes its own entries through audit()", async () => {
      await withTenantTx(db, alNoor, (tx) =>
        audit(
          tx,
          { actor: { type: "user", id: saraId }, requestId: "req-pa-tenant" },
          { action: "x.done", resourceType: "x", resourceId: "1" },
        ),
      );
      const rows = await withTenantTx(db, alNoor, (tx) =>
        tx.select().from(auditLog).where(eq(auditLog.requestId, "req-pa-tenant")),
      );
      expect(rows.map((r) => r.tenantId)).toEqual([alNoor]);
    });
  });

  it("rejects a platform-level entry with a user actor", async () => {
    const err = await rejectionText(
      withPlatformTx(db, (tx) =>
        platformAudit(
          tx,
          { actor: { type: "user", id: saraId }, requestId: "r" },
          { tenantId: null, action: "x.y", resourceType: "x", resourceId: "1" },
        ),
      ),
    );
    expect(err).toMatch(/audit_log_user_has_tenant/);
  });
});
