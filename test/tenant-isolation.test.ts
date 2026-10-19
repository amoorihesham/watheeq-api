import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { tenants, users } from "../src/db/schema/index.js";
import { withTenantTx } from "../src/db/tenant-tx.js";
import { connectAsAdmin, connectAsApp, rejectionText, seedTenant } from "./helpers/db.js";

const NO_CONTEXT = /tenant context is not set/;

describe("tenant isolation (real PostgreSQL, connected as watheeq_app)", () => {
  // A single connection forces every query onto the same pooled connection (criterion 4).
  const appPool = connectAsApp();
  appPool.options.max = 1;
  const db = createDb(appPool);
  const adminPool = connectAsAdmin(1);

  let alNoor = "";
  let alRashid = "";

  beforeAll(async () => {
    // Fixtures use the superuser connection: FORCE RLS applies to the owner role too, and tenants has no INSERT policy.
    const seed = async (name: string, emails: string[]): Promise<string> =>
      (
        await seedTenant(
          adminPool,
          name,
          emails.map((email) => ({ email })),
        )
      ).id;
    alNoor = await seed("Al-Noor", ["sara@alnoor.test", "omar@alnoor.test"]);
    alRashid = await seed("Al-Rashid", ["khalid@alrashid.test"]);
  });

  afterAll(async () => {
    await Promise.all([appPool.end(), adminPool.end()]);
  });

  it("returns only Al-Noor rows from users and tenants without any tenant filter (R0.7)", async () => {
    await withTenantTx(db, alNoor, async (tx) => {
      const userRows = await tx.select().from(users);
      expect(userRows.map((u) => u.email).sort()).toEqual(["omar@alnoor.test", "sara@alnoor.test"]);
      expect(userRows.every((u) => u.tenantId === alNoor)).toBe(true);

      const tenantRows = await tx.select().from(tenants);
      expect(tenantRows.map((t) => t.name)).toEqual(["Al-Noor"]);
    });
  });

  it("returns Al-Rashid rows only in Al-Rashid's context", async () => {
    const rows = await withTenantTx(db, alRashid, (tx) => tx.select().from(users));
    expect(rows.map((u) => u.email)).toEqual(["khalid@alrashid.test"]);
  });

  it("fails, rather than returning zero rows, without a tenant context (R0.8)", async () => {
    const usersErr = await rejectionText(db.select().from(users));
    expect(usersErr).toMatch(NO_CONTEXT);
    const tenantsErr = await rejectionText(db.select().from(tenants));
    expect(tenantsErr).toMatch(NO_CONTEXT);
  });

  it("rejects inserting an Al-Rashid user inside Al-Noor's context (WITH CHECK)", async () => {
    const err = await rejectionText(
      withTenantTx(db, alNoor, (tx) =>
        tx
          .insert(users)
          .values({ tenantId: alRashid, email: "intruder@alrashid.test", passwordHash: "x" }),
      ),
    );
    expect(err).toMatch(/row-level security policy/);
  });

  it("rejects an email that is not lowercased and trimmed", async () => {
    for (const email of ["Sara2@AlNoor.test", " sara2@alnoor.test"]) {
      const err = await rejectionText(
        withTenantTx(db, alNoor, (tx) =>
          tx.insert(users).values({ tenantId: alNoor, email, passwordHash: "x" }),
        ),
      );
      expect(err).toMatch(/users_email_normalized/);
    }
  });

  it("rejects moving an Al-Noor user to Al-Rashid with UPDATE (WITH CHECK)", async () => {
    const err = await rejectionText(
      withTenantTx(db, alNoor, (tx) =>
        tx.update(users).set({ tenantId: alRashid }).where(eq(users.email, "sara@alnoor.test")),
      ),
    );
    expect(err).toMatch(/row-level security policy/);
  });

  it("allows inserting a user for the current tenant", async () => {
    await withTenantTx(db, alNoor, async (tx) => {
      await tx
        .insert(users)
        .values({ tenantId: alNoor, email: "layla@alnoor.test", passwordHash: "x" });
      expect(await tx.select().from(users)).toHaveLength(3);
    });
    // Cleanup through the superuser connection: watheeq_app has no DELETE privilege.
    const client = await adminPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [alNoor]);
      await client.query("delete from users where email = 'layla@alnoor.test'");
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("has no tenant context on the same pooled connection after a tenant transaction ends", async () => {
    expect(appPool.options.max).toBe(1);
    await withTenantTx(db, alNoor, (tx) => tx.select().from(users));
    // Same single connection: the setting is now an empty string, and the function must still raise.
    expect(await rejectionText(db.select().from(users))).toMatch(NO_CONTEXT);
    const result = await db.execute(sql`select current_setting('app.tenant_id', true) as v`);
    expect(["", null]).toContain(result.rows[0]?.v);
  });

  it("rolls back writes when the callback throws", async () => {
    await expect(
      withTenantTx(db, alNoor, async (tx) => {
        await tx
          .insert(users)
          .values({ tenantId: alNoor, email: "ghost@alnoor.test", passwordHash: "x" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await withTenantTx(db, alNoor, (tx) =>
      tx.select().from(users).where(eq(users.email, "ghost@alnoor.test")),
    );
    expect(rows).toEqual([]);
  });

  it("revokes DELETE from the app role", async () => {
    const err = await rejectionText(
      withTenantTx(db, alNoor, (tx) => tx.delete(users).where(eq(users.email, "omar@alnoor.test"))),
    );
    expect(err).toMatch(/permission denied/);
  });

  it("runs as a role that cannot bypass RLS and owns nothing", async () => {
    const role = await db.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

    const user = await db.execute(sql`select current_user as u`);
    expect(user.rows[0]?.u).toBe("watheeq_app");

    const owned = await db.execute(sql`
      select count(*)::int as n from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relowner = (select oid from pg_roles where rolname = current_user)
        and n.nspname not in ('pg_catalog', 'information_schema')`);
    expect(owned.rows[0]?.n).toBe(0);

    const force = await db.execute(sql`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('tenants', 'users') order by relname`);
    expect(force.rows).toEqual([
      { relname: "tenants", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "users", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
