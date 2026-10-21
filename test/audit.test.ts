import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuditEntryType, writeAuditEntry } from "../src/audit/index.js";
import { createDb } from "../src/db/pool.js";
import { auditLog, users } from "../src/db/schema/index.js";
import { withTx } from "../src/db/tx.js";
import { connectToTestDb, rejectionText, seedTenant } from "./helpers/db.js";

const pool = connectToTestDb();
const db = createDb(pool);

let alNoor = "";
let saraId = "";
let khalidId = "";

const entriesFor = (requestId: string) =>
  db.select().from(auditLog).where(eq(auditLog.requestId, requestId)).orderBy(auditLog.id);

const isKhalidActive = async (): Promise<boolean> => {
  const [row] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, khalidId));
  return row?.isActive ?? false;
};

const deactivation = (requestId: string): AuditEntryType => ({
  tenantId: alNoor,
  actor: { type: "user", id: saraId },
  action: "user.deactivated",
  resourceType: "user",
  resourceId: khalidId,
  reason: "Left the company",
  details: { before: { isActive: true }, after: { isActive: false } },
  requestId,
});

beforeAll(async () => {
  const noor = await seedTenant(pool, "audit-al-noor", [
    { email: "audit-sara@alnoor.test" },
    { email: "audit-khalid@alnoor.test" },
  ]);
  alNoor = noor.id;
  [saraId = "", khalidId = ""] = noor.userIds;
});

afterAll(async () => {
  await pool.end();
});

describe("writeAuditEntry (R0.9)", () => {
  it("leaves exactly one correct row when the change commits", async () => {
    await withTx(db, async (tx) => {
      await tx.update(users).set({ isActive: false }).where(eq(users.id, khalidId));
      await writeAuditEntry(tx, deactivation("req-commit"));
    });

    expect(await isKhalidActive()).toBe(false);
    const rows = await entriesFor("req-commit");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: alNoor,
      actorType: "user",
      actorId: saraId,
      action: "user.deactivated",
      resourceType: "user",
      resourceId: khalidId,
      reason: "Left the company",
      details: { before: { isActive: true }, after: { isActive: false } },
      requestId: "req-commit",
    });
    await db.update(users).set({ isActive: true }).where(eq(users.id, khalidId));
  });

  it("leaves no row and no change when the transaction rolls back after the audit write", async () => {
    const failure = withTx(db, async (tx) => {
      await tx.update(users).set({ isActive: false }).where(eq(users.id, khalidId));
      await writeAuditEntry(tx, deactivation("req-rollback"));
      throw new Error("business rule failed after auditing");
    });

    await expect(failure).rejects.toThrow("business rule failed after auditing");
    expect(await entriesFor("req-rollback")).toHaveLength(0);
    expect(await isKhalidActive()).toBe(true);
  });

  it("rolls back the change when the audit write itself fails", async () => {
    const failure = withTx(db, async (tx) => {
      await tx.update(users).set({ isActive: false }).where(eq(users.id, khalidId));
      // A user actor always acts inside a tenant, so the database check rejects this entry.
      await writeAuditEntry(tx, { ...deactivation("req-bad-audit"), tenantId: null });
    });

    expect(await rejectionText(failure)).toMatch(/audit_log_user_has_tenant/);
    expect(await isKhalidActive()).toBe(true);
    expect(await entriesFor("req-bad-audit")).toHaveLength(0);
  });

  it("stores a platform-level entry with a null tenant", async () => {
    await withTx(db, (tx) =>
      writeAuditEntry(tx, {
        tenantId: null,
        actor: { type: "operator", id: saraId },
        action: "plan.updated",
        resourceType: "plan",
        resourceId: "basic",
        details: { before: { userLimit: 10 }, after: { userLimit: 8 } },
        requestId: "req-platform",
      }),
    );

    const rows = await entriesFor("req-platform");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: null,
      actorType: "operator",
      action: "plan.updated",
    });
  });

  it("allows a system entry without an actor id", async () => {
    await withTx(db, (tx) =>
      writeAuditEntry(tx, {
        tenantId: alNoor,
        actor: { type: "system" },
        action: "escalation.fired",
        resourceType: "request",
        resourceId: "req-42",
        requestId: "req-system",
      }),
    );

    const [row] = await entriesFor("req-system");
    expect(row).toMatchObject({ actorType: "system", actorId: null, reason: null, details: null });
  });
});
