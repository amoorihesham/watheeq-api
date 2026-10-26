import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { holdersOf } from "../src/modules/tenant-access/index.js";
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser } from "./helpers/db.js";

// Phase 7 spec, 4.3 "Notifying": who `holdersOf` returns (step 7.2).

const pool = connectToTestDb();
const db = createDb(pool);

let alNoorId = "";
let alRashidId = "";
const ids = {} as Record<string, string>;

async function addMember(
  tenantId: string,
  name: string,
  roleId: string,
  isActive = true,
): Promise<string> {
  const userId = await seedUser(pool, { email: `${name}@holders-of.test`, isActive });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    tenantId,
    userId,
    roleId,
  ]);
  return userId;
}

beforeAll(async () => {
  const alNoor = await seedSubscribedTenant(pool, "ho-al-noor", [
    { email: "sara@holders-of.test" },
  ]);
  alNoorId = alNoor.id;
  ids.sara = alNoor.userIds[0] ?? "";

  const finance = await seedRole(pool, alNoor.id, {
    name: "Finance Lead",
    permissions: [{ key: "subscription.view", scope: "organization" }],
  });
  const reviewer = await seedRole(pool, alNoor.id, {
    name: "Reviewer",
    permissions: [{ key: "request.view", scope: "own" }],
  });
  ids.majed = await addMember(alNoor.id, "majed", finance);
  ids.huda = await addMember(alNoor.id, "huda", reviewer);
  ids.retired = await addMember(alNoor.id, "retired", finance, false);

  const rashid = await seedSubscribedTenant(pool, "ho-al-rashid", [
    { email: "salem@holders-of.test" },
  ]);
  alRashidId = rashid.id;
  ids.salem = rashid.userIds[0] ?? "";
});

afterAll(async () => {
  await pool.end();
});

describe("holdersOf", () => {
  it("returns the Tenant Admin and a custom role that grants the permission, not a role without it", async () => {
    const holders = await holdersOf(db, alNoorId, "subscription.view");
    expect(holders.sort()).toEqual([ids.sara, ids.majed].sort());
  });

  it("gives the Tenant Admin every permission, including ones no stored grant names", async () => {
    expect(await holdersOf(db, alNoorId, "escalation.manage")).toEqual([ids.sara]);
  });

  it("finds a grant at any scope", async () => {
    expect(await holdersOf(db, alNoorId, "request.view")).toEqual(
      expect.arrayContaining([ids.sara, ids.huda]),
    );
    expect(await holdersOf(db, alNoorId, "request.view")).not.toContain(ids.majed);
  });

  it("leaves out an inactive member, who holds the role but is not notified", async () => {
    expect(await holdersOf(db, alNoorId, "subscription.view")).not.toContain(ids.retired);
  });

  it("stays inside the tenant", async () => {
    expect(await holdersOf(db, alRashidId, "subscription.view")).toEqual([ids.salem]);
    const noor = await holdersOf(db, alNoorId, "subscription.view");
    expect(noor).not.toContain(ids.salem);
  });

  it("returns nobody when no active member holds the permission", async () => {
    await pool.query("update users set is_active = false where id = $1", [ids.sara]);
    try {
      expect(await holdersOf(db, alNoorId, "escalation.manage")).toEqual([]);
    } finally {
      await pool.query("update users set is_active = true where id = $1", [ids.sara]);
    }
  });
});
