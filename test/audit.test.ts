import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuditContext, audit } from "../src/audit/index.js";
import { createDb, type Tx } from "../src/db/pool.js";
import { auditLog, users } from "../src/db/schema/index.js";
import { withTenantTx } from "../src/db/tenant-tx.js";
import { connectAsAdmin, connectAsApp, rejectionText, seedTenant } from "./helpers/db.js";

describe("audit log (real PostgreSQL, connected as watheeq_app)", () => {
  const appPool = connectAsApp();
  const db = createDb(appPool);
  const adminPool = connectAsAdmin(1);

  let alNoor = "";
  let alRashid = "";
  let saraId = "";
  let adminUserId = "";

  const seed = (name: string, emails: string[]) =>
    seedTenant(
      adminPool,
      name,
      emails.map((email) => ({ email })),
    );

  const ctx = (): AuditContext => ({
    actor: { type: "user", id: adminUserId },
    requestId: "req-audit-1",
  });

  const entriesFor = (tenantId: string) =>
    withTenantTx(db, tenantId, (tx) => tx.select().from(auditLog).orderBy(auditLog.id));

  const setSaraActive = (tx: Tx, isActive: boolean) =>
    tx.update(users).set({ isActive }).where(eq(users.id, saraId));

  const isSaraActive = async (): Promise<boolean> => {
    const rows = await withTenantTx(db, alNoor, (tx) =>
      tx.select({ a: users.isActive }).from(users).where(eq(users.id, saraId)),
    );
    return rows[0]?.a ?? false;
  };

  beforeAll(async () => {
    const noor = await seed("Al-Noor", ["audit-sara@alnoor.test", "audit-omar@alnoor.test"]);
    alNoor = noor.id;
    saraId = noor.userIds[0] ?? "";
    adminUserId = noor.userIds[1] ?? "";
    alRashid = (await seed("Al-Rashid", ["audit-khalid@alrashid.test"])).id;
  });

  afterAll(async () => {
    await Promise.all([appPool.end(), adminPool.end()]);
  });

  it("a committed change leaves exactly one correct audit row", async () => {
    await withTenantTx(db, alNoor, async (tx) => {
      await setSaraActive(tx, false);
      await audit(tx, ctx(), {
        action: "user.deactivated",
        resourceType: "user",
        resourceId: saraId,
        reason: "Left the company",
        details: { before: { isActive: true }, after: { isActive: false } },
      });
    });

    expect(await isSaraActive()).toBe(false);
    const rows = await entriesFor(alNoor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: alNoor,
      actorType: "user",
      actorId: adminUserId,
      action: "user.deactivated",
      resourceType: "user",
      resourceId: saraId,
      reason: "Left the company",
      details: { before: { isActive: true }, after: { isActive: false } },
      requestId: "req-audit-1",
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("a rolled-back change leaves no audit row", async () => {
    const before = (await entriesFor(alNoor)).length;
    await expect(
      withTenantTx(db, alNoor, async (tx) => {
        await setSaraActive(tx, true);
        await audit(tx, ctx(), {
          action: "user.activated",
          resourceType: "user",
          resourceId: saraId,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await entriesFor(alNoor)).toHaveLength(before);
    expect(await isSaraActive()).toBe(false);
  });

  it("rolls back the business change when the audit insert fails", async () => {
    const before = (await entriesFor(alNoor)).length;
    const badCtx = { actor: { type: "robot", id: adminUserId }, requestId: "r" };
    const err = await rejectionText(
      withTenantTx(db, alNoor, async (tx) => {
        await setSaraActive(tx, true);
        await audit(tx, badCtx as unknown as AuditContext, {
          action: "user.activated",
          resourceType: "user",
          resourceId: saraId,
        });
      }),
    );
    expect(err).toMatch(/audit_log_actor_type/);
    expect(await isSaraActive()).toBe(false);
    expect(await entriesFor(alNoor)).toHaveLength(before);
  });

  it("requires an actor id unless the actor is the system", async () => {
    const noId = { actor: { type: "user" }, requestId: "r" } as unknown as AuditContext;
    const err = await rejectionText(
      withTenantTx(db, alNoor, (tx) =>
        audit(tx, noId, { action: "x.y", resourceType: "x", resourceId: "1" }),
      ),
    );
    expect(err).toMatch(/audit_log_actor_id/);

    await withTenantTx(db, alNoor, (tx) =>
      audit(
        tx,
        { actor: { type: "system" }, requestId: "r-sys" },
        { action: "job.ran", resourceType: "job", resourceId: "1" },
      ),
    );
    const rows = await entriesFor(alNoor);
    expect(rows.find((r) => r.requestId === "r-sys")).toMatchObject({
      actorType: "system",
      actorId: null,
    });
  });

  it("rejects UPDATE and DELETE on audit_log", async () => {
    const upd = await rejectionText(
      withTenantTx(db, alNoor, (tx) => tx.update(auditLog).set({ reason: "tampered" })),
    );
    expect(upd).toMatch(/permission denied/);
    const del = await rejectionText(withTenantTx(db, alNoor, (tx) => tx.delete(auditLog)));
    expect(del).toMatch(/permission denied/);
    expect((await entriesFor(alNoor)).some((r) => r.reason === "tampered")).toBe(false);
  });

  it("isolates tenants and fails without a tenant context", async () => {
    await withTenantTx(db, alRashid, (tx) =>
      audit(
        tx,
        { actor: { type: "system" }, requestId: "r-rashid" },
        { action: "job.ran", resourceType: "job", resourceId: "2" },
      ),
    );
    const noorRows = await entriesFor(alNoor);
    expect(noorRows.every((r) => r.tenantId === alNoor)).toBe(true);
    expect(noorRows.some((r) => r.requestId === "r-rashid")).toBe(false);

    const crossRead = await withTenantTx(db, alRashid, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, alNoor)),
    );
    expect(crossRead).toEqual([]);

    expect(await rejectionText(db.select().from(auditLog))).toMatch(/tenant context is not set/);
  });

  it("always records the context tenant, never a caller-chosen one", async () => {
    // A hand-written insert naming another tenant is rejected by the RLS WITH CHECK.
    const err = await rejectionText(
      withTenantTx(db, alNoor, (tx) =>
        tx.insert(auditLog).values({
          tenantId: alRashid,
          actorType: "system",
          action: "forged",
          resourceType: "x",
          resourceId: "1",
          requestId: "r-forged",
        }),
      ),
    );
    expect(err).toMatch(/row-level security policy/);

    // The helper has no tenant parameter: a forged field smuggled into the entry is ignored.
    await withTenantTx(db, alNoor, (tx) =>
      audit(tx, ctx(), {
        action: "user.touched",
        resourceType: "user",
        resourceId: saraId,
        tenantId: alRashid,
      } as never),
    );
    const rows = await withTenantTx(db, alNoor, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "user.touched")),
    );
    expect(rows.map((r) => r.tenantId)).toEqual([alNoor]);
  });

  it("does not compile when called with the top-level db instead of a transaction", async () => {
    // @ts-expect-error audit() accepts only a transaction, never the top-level db.
    const call = audit(db, ctx(), { action: "x.y", resourceType: "x", resourceId: "1" });
    // At runtime it also fails: there is no tenant context outside withTenantTx.
    await expect(call).rejects.toThrow();
  });
});
