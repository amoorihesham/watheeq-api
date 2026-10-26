import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  connectToTestDb,
  rejectionText,
  seedRole,
  seedSubscribedTenant,
  seedUser,
  waitUntilBlockedOn,
} from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@po-alnoor.test";
const HUDA = "huda@po-alnoor.test";
const NORA = "nora@po-alnoor.test";
const VIEWER = "viewer@po-alnoor.test";
const RASHID_ADMIN = "admin@po-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let alNoor = "";
let sara = "";
let huda = "";
let nora = "";
let viewer = "";
let rashid = "";
let memberRoleId = "";
let counter = 0;

let legal = "";
let contracts = "";
let litigation = "";
let finance = "";
let procurement = "";
let rashidUnit = "";

const ids = {
  huda: "",
  ahmed: "",
  faisal: "",
  nora: "",
  khalid: "",
  reem: "",
  majed: "",
  lina: "",
};

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  delete: (path: string) => request(app).delete(path).set("Cookie", accessCookie(access)),
});

const org = (key: string) => ({ key, scope: "organization" });
const nextName = (prefix: string) => `${prefix} ${++counter}`;

async function insertUnit(
  tenantId: string,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id",
    [tenantId, parentId ? "section" : "department", parentId, name],
  );
  return rows[0]?.id ?? "";
}

interface MemberOptions {
  manager?: boolean;
  roleId?: string;
  email?: string;
  passwordHash?: string;
}

/** A member of Al-Noor in `unitId` (null: directly under the organization). Returns their id. */
async function addMember(
  userName: string,
  unitId: string | null,
  options: MemberOptions = {},
): Promise<string> {
  const id = await seedUser(pool, {
    email: options.email ?? `${userName.toLowerCase()}.${++counter}@po-alnoor.test`,
    userName,
    ...(options.passwordHash ? { passwordHash: options.passwordHash } : {}),
  });
  await pool.query(
    "insert into tenant_members (tenant_id, user_id, role_id, unit_id, is_manager) values ($1, $2, $3, $4, $5)",
    [alNoor, id, options.roleId ?? memberRoleId, unitId, options.manager ?? false],
  );
  return id;
}

/** Creates a position as Huda through the API. Returns its id. */
async function createPosition(name: string, unitId: string): Promise<string> {
  const res = await as(huda).post("/positions", { unitId, name });
  expect(res.status).toBe(201);
  return res.body.position.id;
}

const holdersOf = async (positionId: string) =>
  (await as(huda).get(`/positions/${positionId}`)).body.position.holders.map(
    (holder: { userId: string }) => holder.userId,
  );

const positionOf = (userId: string) =>
  pool
    .query("select position_id from tenant_members where user_id = $1", [userId])
    .then((result) => result.rows[0].position_id as string | null);

const auditOf = (resourceId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_type, actor_id, details from audit_log where resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

/**
 * Holds the lock a unit delete takes, runs `during` inside that transaction, then commits it. The lock is
 * released even when `during` fails, so a failing race test cannot hang the ones after it.
 */
async function whileUnitLocked(
  unitId: string,
  during: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from org_units where id = $1 for update", [unitId]);
    await during(client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, "po-al-noor", [
    { email: SARA, userName: "Sara", passwordHash },
  ]);
  alNoor = tenant.id;
  memberRoleId = tenant.memberRoleId;
  const headOfLegal = await seedRole(pool, alNoor, {
    name: "Head of Legal",
    permissions: ["org.view", "user.view", "position.view", "position.manage"].map(org),
  });
  const viewerRole = await seedRole(pool, alNoor, {
    name: "Position Viewer",
    permissions: [org("position.view")],
  });

  legal = await insertUnit(alNoor, "Legal Affairs");
  contracts = await insertUnit(alNoor, "Contracts", legal);
  litigation = await insertUnit(alNoor, "Litigation", legal);
  finance = await insertUnit(alNoor, "Finance");
  procurement = await insertUnit(alNoor, "Procurement", finance);

  ids.huda = await addMember("Huda", legal, {
    manager: true,
    roleId: headOfLegal,
    email: HUDA,
    passwordHash,
  });
  ids.ahmed = await addMember("Ahmed", legal, { manager: true });
  ids.faisal = await addMember("Faisal", contracts, { manager: true });
  ids.nora = await addMember("Nora", contracts, { email: NORA, passwordHash });
  ids.khalid = await addMember("Khalid", procurement);
  ids.reem = await addMember("Reem", procurement, { manager: true });
  ids.majed = await addMember("Majed", finance, { manager: true });
  ids.lina = await addMember("Lina", null);
  await addMember("Viewer", null, { roleId: viewerRole, email: VIEWER, passwordHash });

  const rashidTenant = await seedSubscribedTenant(pool, "po-al-rashid", [
    { email: RASHID_ADMIN, passwordHash },
  ]);
  rashidUnit = await insertUnit(rashidTenant.id, "Legal Affairs");

  sara = (await login(app, SARA, PASSWORD)).access;
  huda = (await login(app, HUDA, PASSWORD)).access;
  nora = (await login(app, NORA, PASSWORD)).access;
  viewer = (await login(app, VIEWER, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("creating positions (R5.1)", () => {
  it("creates a position in a unit with no holders, and audits it", async () => {
    const res = await as(huda).post("/positions", {
      unitId: contracts,
      name: "  Contracts Intake  ",
    });
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.position).toEqual({
      id: expect.any(String),
      unitId: contracts,
      name: "Contracts Intake",
      retired: false,
      holders: [],
    });
    expect(await auditOf(res.body.position.id)).toEqual([
      {
        action: "position.created",
        tenant_id: alNoor,
        actor_type: "user",
        actor_id: ids.huda,
        details: { name: "Contracts Intake", unitId: contracts },
      },
    ]);
  });

  it("creates a position in a department as well as in a section", async () => {
    expect((await as(huda).post("/positions", { unitId: legal, name: "Legal Desk" })).status).toBe(
      201,
    );
  });

  it("refuses a second name in any case, in any unit", async () => {
    await createPosition("Contracts Supervisor", contracts);
    for (const [unitId, name] of [
      [contracts, "contracts supervisor"],
      [procurement, "CONTRACTS SUPERVISOR"],
    ] as const) {
      const res = await as(huda).post("/positions", { unitId, name });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TAKEN");
      expect(res.body.error.details).toEqual([{ path: "name", code: "taken" }]);
    }
  });

  it("refuses a unit that does not exist or belongs to another tenant", async () => {
    for (const unitId of [rashidUnit, "00000000-0000-4000-8000-000000000000"]) {
      const res = await as(huda).post("/positions", { unitId, name: nextName("Nowhere") });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "unitId", code: "unknown_unit" }]);
    }
  });

  it("validates the body strictly", async () => {
    const empty = await as(huda).post("/positions", { unitId: contracts, name: "   " });
    expect(empty.body.error.details).toEqual([{ path: "name", code: "too_small" }]);
    const extra = await as(huda).post("/positions", {
      unitId: contracts,
      name: nextName("Extra"),
      holders: [],
    });
    expect(extra.body.error.details).toEqual([{ path: "holders", code: "unknown_field" }]);
  });
});

describe("renaming positions (R5.1)", () => {
  it("renames, audits the change, and keeps the unit", async () => {
    const id = await createPosition(nextName("Old Name"), contracts);
    const res = await as(huda).patch(`/positions/${id}`, { name: "New Name Clerk" });
    expect(res.status).toBe(200);
    expect(res.body.position).toMatchObject({ unitId: contracts, name: "New Name Clerk" });
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "position.updated",
      details: {
        before: { name: expect.stringMatching(/^Old Name/) },
        after: { name: "New Name Clerk" },
      },
    });
  });

  it("never changes the unit", async () => {
    const id = await createPosition(nextName("Fixed Unit"), contracts);
    const res = await as(huda).patch(`/positions/${id}`, { unitId: procurement });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ path: "unitId", code: "unknown_field" });
  });

  it("is a no-op for the same name, with no audit entry", async () => {
    const name = nextName("Same Name");
    const id = await createPosition(name, contracts);
    const res = await as(huda).patch(`/positions/${id}`, { name });
    expect(res.status).toBe(200);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("allows a change of case only", async () => {
    const id = await createPosition("case change", contracts);
    expect((await as(huda).patch(`/positions/${id}`, { name: "Case Change" })).status).toBe(200);
  });

  it("refuses a name another active position has, in any case", async () => {
    const taken = await createPosition(nextName("Taken"), contracts);
    const other = await createPosition(nextName("Other"), procurement);
    const name = (await as(huda).get(`/positions/${taken}`)).body.position.name.toUpperCase();
    const res = await as(huda).patch(`/positions/${other}`, { name });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TAKEN");
    expect(res.body.error.details).toEqual([{ path: "name", code: "taken" }]);
  });

  it("refuses editing a retired position", async () => {
    const id = await createPosition(nextName("Retired Edit"), contracts);
    await as(huda).post(`/positions/${id}/retire`);
    const res = await as(huda).patch(`/positions/${id}`, { name: nextName("Edited") });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_RETIRED");
  });
});

describe("holders (R5.2)", () => {
  it("makes a unit manager the holder: a manager may also hold a position", async () => {
    const id = await createPosition(nextName("Supervisor"), contracts);
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [ids.faisal] });
    expect(res.status).toBe(200);
    expect(res.body.position.holders).toEqual([{ userId: ids.faisal, name: "Faisal" }]);
    expect(await positionOf(ids.faisal)).toBe(id);
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "position.holders_set",
      details: { before: [], after: [ids.faisal] },
    });
    await as(huda).put(`/positions/${id}/holders`, { userIds: [] });
  });

  it("holds several people at once, and replaces the set as a whole", async () => {
    const colleague = await addMember("Colleague", contracts);
    const id = await createPosition(nextName("Reviewers"), contracts);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [ids.nora, ids.faisal] });
    expect((await holdersOf(id)).sort()).toEqual([ids.nora, ids.faisal].sort());
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [colleague, ids.nora] });
    expect(res.status).toBe(200);
    expect((await holdersOf(id)).sort()).toEqual([colleague, ids.nora].sort());
    expect(await positionOf(ids.faisal)).toBeNull();
    const audit = (await auditOf(id)).at(-1);
    expect(audit.details.before).toEqual([ids.nora, ids.faisal].sort());
    expect(audit.details.after).toEqual([colleague, ids.nora].sort());
    await as(huda).put(`/positions/${id}/holders`, { userIds: [] });
  });

  it("vacates the position with an empty list", async () => {
    const holder = await addMember("Temp Holder", contracts);
    const id = await createPosition(nextName("Vacated"), contracts);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [] });
    expect(res.body.position.holders).toEqual([]);
    expect(await positionOf(holder)).toBeNull();
  });

  it("refuses someone outside the unit, naming the entry", async () => {
    const id = await createPosition(nextName("Procurement Reviewer"), procurement);
    const res = await as(huda).put(`/positions/${id}/holders`, {
      userIds: [ids.khalid, ids.nora],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "userIds.1", code: "not_unit_member" }]);
    expect(await holdersOf(id)).toEqual([]);
  });

  it("treats members of a section as outside its department, and members with no unit as outside every unit", async () => {
    const id = await createPosition(nextName("Legal Reviewer"), legal);
    for (const userId of [ids.faisal, ids.lina]) {
      const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [userId] });
      expect(res.body.error.details).toEqual([{ path: "userIds.0", code: "not_unit_member" }]);
    }
  });

  it("refuses a person who holds another position", async () => {
    const taker = await addMember("Double Hatter", contracts);
    const first = await createPosition(nextName("First Hat"), contracts);
    const second = await createPosition(nextName("Second Hat"), contracts);
    await as(huda).put(`/positions/${first}/holders`, { userIds: [taker] });
    const res = await as(huda).put(`/positions/${second}/holders`, { userIds: [taker] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "userIds.0", code: "holds_other_position" }]);
    expect(await positionOf(taker)).toBe(first);
  });

  it("refuses a deactivated member", async () => {
    const leaver = await addMember("Leaver", contracts);
    await pool.query("update users set is_active = false where id = $1", [leaver]);
    const id = await createPosition(nextName("Inactive Hold"), contracts);
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [leaver] });
    expect(res.body.error.details).toEqual([{ path: "userIds.0", code: "user_inactive" }]);
  });

  it("refuses another tenant's user and malformed ids", async () => {
    const id = await createPosition(nextName("Isolated Hold"), contracts);
    const rashidUser = (await pool.query("select id from users where email = $1", [RASHID_ADMIN]))
      .rows[0].id;
    const foreign = await as(huda).put(`/positions/${id}/holders`, { userIds: [rashidUser] });
    expect(foreign.body.error.details).toEqual([{ path: "userIds.0", code: "not_unit_member" }]);
    const malformed = await as(huda).put(`/positions/${id}/holders`, { userIds: ["nobody"] });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details[0].path).toBe("userIds.0");
  });

  it("treats a repeated id as one holder", async () => {
    const holder = await addMember("Repeated", contracts);
    const id = await createPosition(nextName("Repeat"), contracts);
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [holder, holder] });
    expect(res.status).toBe(200);
    expect(res.body.position.holders).toHaveLength(1);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [] });
  });

  it("is a no-op for the same holders, with no audit entry", async () => {
    const holder = await addMember("Steady", contracts);
    const id = await createPosition(nextName("Steady Post"), contracts);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    const entries = (await auditOf(id)).length;
    expect((await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] })).status).toBe(
      200,
    );
    expect((await auditOf(id)).length).toBe(entries);
  });

  it("refuses changing a retired position's holders", async () => {
    const id = await createPosition(nextName("Retired Hold"), contracts);
    await as(huda).post(`/positions/${id}/retire`);
    const res = await as(huda).put(`/positions/${id}/holders`, { userIds: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_RETIRED");
  });
});

describe("the database keeps holders in the unit (R5.2, R5.3)", () => {
  it("refuses a holder outside the position's unit", async () => {
    const id = await createPosition(nextName("Strict Unit"), procurement);
    const err = await rejectionText(
      pool.query("update tenant_members set position_id = $2 where user_id = $1", [ids.nora, id]),
    );
    expect(err).toMatch(/tenant_members_position_fk/);
  });

  it("refuses moving a holder without clearing the position", async () => {
    const holder = await addMember("Anchored", contracts);
    const id = await createPosition(nextName("Anchor"), contracts);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    const err = await rejectionText(
      pool.query("update tenant_members set unit_id = $2 where user_id = $1", [holder, litigation]),
    );
    expect(err).toMatch(/tenant_members_position_fk/);
  });

  it("refuses a position for a member with no unit", async () => {
    const id = await createPosition(nextName("No Unit Hold"), contracts);
    const err = await rejectionText(
      pool.query("update tenant_members set position_id = $2 where user_id = $1", [ids.lina, id]),
    );
    expect(err).toMatch(/tenant_members_position_has_unit/);
  });

  it("refuses a holder of another tenant", async () => {
    const id = await createPosition(nextName("Tenant Hold"), contracts);
    const rashidUser = (await pool.query("select id from users where email = $1", [RASHID_ADMIN]))
      .rows[0].id;
    const err = await rejectionText(
      pool.query("update tenant_members set unit_id = $2, position_id = $3 where user_id = $1", [
        rashidUser,
        rashidUnit,
        id,
      ]),
    );
    expect(err).toMatch(/tenant_members_position_fk/);
  });

  it("refuses an unplaced position", async () => {
    const err = await rejectionText(
      pool.query("insert into positions (tenant_id, name) values ($1, 'Floating')", [alNoor]),
    );
    expect(err).toMatch(/positions_unit_or_retired/);
  });
});

describe("a holder who moves or leaves stops holding the position (R5.3)", () => {
  it("clears the position on a move to another unit, and audits it", async () => {
    const holder = await addMember("Mover", procurement);
    const id = await createPosition(nextName("Procurement Reviewer"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });

    const res = await as(sara).patch(`/users/${holder}`, { unitId: finance });
    expect(res.status).toBe(200);
    expect(await holdersOf(id)).toEqual([]);
    expect(await positionOf(holder)).toBeNull();
    expect((await auditOf(holder)).at(-1)).toMatchObject({
      action: "user.updated",
      details: {
        before: { unitId: procurement, positionId: id },
        after: { unitId: finance, positionId: null },
      },
    });
  });

  it("clears the position on a move to the organization level", async () => {
    const holder = await addMember("Leaves Unit", procurement);
    const id = await createPosition(nextName("Leaving Post"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    await as(sara).patch(`/users/${holder}`, { unitId: null });
    expect(await positionOf(holder)).toBeNull();
  });

  it("keeps the position when an update does not move the user", async () => {
    const holder = await addMember("Renamed", procurement);
    const id = await createPosition(nextName("Staying Post"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    await as(sara).patch(`/users/${holder}`, { userName: "Renamed Again" });
    expect(await positionOf(holder)).toBe(id);
    const sameUnit = await as(sara).patch(`/users/${holder}`, { unitId: procurement });
    expect(sameUnit.status).toBe(200);
    expect(await positionOf(holder)).toBe(id);
  });

  it("clears the position on deactivation, audits it, and does not restore it on reactivation", async () => {
    const holder = await addMember("Deactivated Holder", procurement);
    const id = await createPosition(nextName("Deactivation Post"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });

    expect((await as(sara).post(`/users/${holder}/deactivate`)).status).toBe(200);
    expect(await holdersOf(id)).toEqual([]);
    expect((await auditOf(holder)).at(-1)).toMatchObject({
      action: "user.deactivated",
      details: { before: { positionId: id }, after: { positionId: null } },
    });

    expect((await as(sara).post(`/users/${holder}/reactivate`)).status).toBe(200);
    expect(await positionOf(holder)).toBeNull();
  });

  it("clears the manager role and the position together on deactivation", async () => {
    const holder = await addMember("Manager Holder", procurement, { manager: true });
    const id = await createPosition(nextName("Both Post"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    await as(sara).post(`/users/${holder}/deactivate`);
    expect((await auditOf(holder)).at(-1).details).toEqual({
      before: { isManager: true, positionId: id },
      after: { isManager: false, positionId: null },
    });
  });
});

describe("listing and viewing positions", () => {
  it("lists active positions by name with their holders, and filters by unit", async () => {
    const holder = await addMember("Zed Holder", litigation);
    const zulu = await createPosition("Zulu Litigation Desk", litigation);
    const alpha = await createPosition("Alpha Litigation Desk", litigation);
    await as(huda).put(`/positions/${zulu}/holders`, { userIds: [holder] });

    const res = await as(huda).get(`/positions?unitId=${litigation}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.positions).toEqual([
      { id: alpha, unitId: litigation, name: "Alpha Litigation Desk", retired: false, holders: [] },
      {
        id: zulu,
        unitId: litigation,
        name: "Zulu Litigation Desk",
        retired: false,
        holders: [{ userId: holder, name: "Zed Holder" }],
      },
    ]);
    const all = await as(huda).get("/positions");
    const names = all.body.positions.map((position: { name: string }) => position.name);
    expect(names).toEqual(
      [...names].sort((a: string, b: string) => a.localeCompare(b, "und", { sensitivity: "base" })),
    );
    await as(huda).put(`/positions/${zulu}/holders`, { userIds: [] });
  });

  it("hides retired positions unless asked", async () => {
    const id = await createPosition(nextName("Hidden Later"), contracts);
    await as(huda).post(`/positions/${id}/retire`);
    const listed = (path: string) =>
      as(huda)
        .get(path)
        .then((res) => res.body.positions.map((position: { id: string }) => position.id));
    expect(await listed("/positions")).not.toContain(id);
    expect(await listed("/positions?includeRetired=true")).toContain(id);
    expect((await as(huda).get(`/positions/${id}`)).body.position.retired).toBe(true);
  });

  it("answers an unknown or malformed id with 404", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await as(huda).get(`/positions/${id}`)).status).toBe(404);
      expect((await as(huda).patch(`/positions/${id}`, { name: "X" })).status).toBe(404);
      expect((await as(huda).put(`/positions/${id}/holders`, { userIds: [] })).status).toBe(404);
      expect((await as(huda).post(`/positions/${id}/retire`)).status).toBe(404);
      expect((await as(huda).post(`/positions/${id}/restore`)).status).toBe(404);
    }
  });
});

describe("retiring and restoring (R5.15, R5.16)", () => {
  it("retires a position, removes its holders, and audits who lost it", async () => {
    const holder = await addMember("Retiree", procurement);
    const id = await createPosition(nextName("Retiring Post"), procurement);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });

    const res = await as(huda).post(`/positions/${id}/retire`);
    expect(res.status).toBe(200);
    expect(res.body.position).toMatchObject({ retired: true, holders: [] });
    expect(await positionOf(holder)).toBeNull();
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "position.retired",
      details: { removedHolders: [holder] },
    });
  });

  it("is a no-op the second time", async () => {
    const id = await createPosition(nextName("Twice Retired"), contracts);
    await as(huda).post(`/positions/${id}/retire`);
    const entries = (await auditOf(id)).length;
    expect((await as(huda).post(`/positions/${id}/retire`)).status).toBe(200);
    expect((await auditOf(id)).length).toBe(entries);
  });

  it("restores a position vacant, and audits it", async () => {
    const holder = await addMember("Restored Holder", contracts);
    const id = await createPosition(nextName("Restored Post"), contracts);
    await as(huda).put(`/positions/${id}/holders`, { userIds: [holder] });
    await as(huda).post(`/positions/${id}/retire`);

    const res = await as(huda).post(`/positions/${id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.position).toMatchObject({ retired: false, holders: [] });
    expect((await auditOf(id)).at(-1).action).toBe("position.restored");
    const entries = (await auditOf(id)).length;
    expect((await as(huda).post(`/positions/${id}/restore`)).status).toBe(200);
    expect((await auditOf(id)).length).toBe(entries);
  });

  it("lets a retired position's name be used again, and refuses restoring it while it is taken", async () => {
    const name = nextName("Reused Name");
    const old = await createPosition(name, contracts);
    await as(huda).post(`/positions/${old}/retire`);
    const replacement = await createPosition(name, procurement);
    const res = await as(huda).post(`/positions/${old}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TAKEN");
    expect(res.body.error.details).toEqual([{ path: "name", code: "taken" }]);
    await as(huda).post(`/positions/${replacement}/retire`);
    expect((await as(huda).post(`/positions/${old}/restore`)).status).toBe(200);
  });
});

describe("deleting a unit with positions (R5.15)", () => {
  it("refuses while the unit has an active position", async () => {
    const unit = await insertUnit(alNoor, nextName("Doomed Section"), legal);
    const id = await createPosition(nextName("Doomed Post"), unit);
    const res = await as(sara).delete(`/org-units/${unit}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UNIT_NOT_EMPTY");

    await as(huda).post(`/positions/${id}/retire`);
    expect((await as(sara).delete(`/org-units/${unit}`)).status).toBe(204);
  });

  it("detaches retired positions, which can then be read but not restored", async () => {
    const unit = await insertUnit(alNoor, nextName("Gone Section"), legal);
    const id = await createPosition(nextName("Gone Post"), unit);
    await as(huda).post(`/positions/${id}/retire`);
    await as(sara).delete(`/org-units/${unit}`);

    const read = await as(huda).get(`/positions/${id}`);
    expect(read.body.position).toMatchObject({ unitId: null, retired: true });
    const res = await as(huda).post(`/positions/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POSITION_UNIT_GONE");
    expect((await as(huda).patch(`/positions/${id}`, { name: nextName("Late") })).status).toBe(409);
  });

  it("refuses creating a position in a unit deleted meanwhile", async () => {
    const unit = await insertUnit(alNoor, nextName("Race Section"), legal);
    const creating = as(huda)
      .post("/positions", { unitId: unit, name: nextName("Race Post") })
      .then((res) => res);
    await whileUnitLocked(unit, async (client) => {
      await waitUntilBlockedOn(pool, "positions");
      await client.query("delete from org_units where id = $1", [unit]);
    });
    const res = await creating;
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "unitId", code: "unknown_unit" }]);
  });

  it("refuses restoring into a unit deleted meanwhile", async () => {
    const unit = await insertUnit(alNoor, nextName("Restore Race Section"), legal);
    const id = await createPosition(nextName("Restore Race Post"), unit);
    await as(huda).post(`/positions/${id}/retire`);

    const restoring = as(huda)
      .post(`/positions/${id}/restore`)
      .then((res) => res);
    await whileUnitLocked(unit, async (client) => {
      await waitUntilBlockedOn(pool, "org_units");
      await client.query("update positions set unit_id = null where id = $1", [id]);
      await client.query("delete from org_units where id = $1", [unit]);
    });
    const res = await restoring;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POSITION_UNIT_GONE");
  });
});

describe("authorization (R5.17)", () => {
  it("refuses a member with no position permissions", async () => {
    const id = await createPosition(nextName("Guarded"), contracts);
    for (const res of [
      await as(nora).get("/positions"),
      await as(nora).get(`/positions/${id}`),
      await as(nora).post("/positions", { unitId: contracts, name: "X" }),
      await as(nora).patch(`/positions/${id}`, { name: "X" }),
      await as(nora).put(`/positions/${id}/holders`, { userIds: [] }),
      await as(nora).post(`/positions/${id}/retire`),
      await as(nora).post(`/positions/${id}/restore`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("lets position.view read but not change", async () => {
    const id = await createPosition(nextName("Viewable"), contracts);
    expect((await as(viewer).get("/positions")).status).toBe(200);
    expect((await as(viewer).get(`/positions/${id}`)).status).toBe(200);
    expect((await as(viewer).post(`/positions/${id}/retire`)).status).toBe(403);
    expect((await as(viewer).post("/positions", { unitId: contracts, name: "Y" })).status).toBe(
      403,
    );
  });

  it("lets the Tenant Admin manage without any role change", async () => {
    const res = await as(sara).post("/positions", { unitId: contracts, name: nextName("Admin") });
    expect(res.status).toBe(201);
  });

  it("requires a signed-in user", async () => {
    expect((await request(app).get("/positions")).status).toBe(401);
  });
});

describe("Read-only subscriptions (R5.18)", () => {
  it("refuses changes and still shows positions", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "po-read-only", [
      { email: "admin@po-read-only.test", passwordHash },
    ]);
    const unit = await insertUnit(tenant.id, "Legal");
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const admin = (await login(app, "admin@po-read-only.test", PASSWORD)).access;
    const res = await as(admin).post("/positions", { unitId: unit, name: "Late" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    expect((await as(admin).get("/positions")).status).toBe(200);
  });
});

describe("tenant isolation (R5.19)", () => {
  it("shows each tenant only its own positions", async () => {
    const mine = await createPosition(nextName("Al-Noor Only"), contracts);
    const theirs = await as(rashid).post("/positions", {
      unitId: rashidUnit,
      name: "Al-Rashid Only",
    });
    expect(theirs.status).toBe(201);
    const noorIds = (await as(huda).get("/positions")).body.positions.map(
      (position: { id: string }) => position.id,
    );
    const rashidIds = (await as(rashid).get("/positions")).body.positions.map(
      (position: { id: string }) => position.id,
    );
    expect(noorIds).not.toContain(theirs.body.position.id);
    expect(rashidIds).toEqual([theirs.body.position.id]);
    expect(rashidIds).not.toContain(mine);
  });

  it("answers another tenant's position with 404 on every route", async () => {
    const id = await createPosition(nextName("Foreign"), contracts);
    expect((await as(rashid).get(`/positions/${id}`)).status).toBe(404);
    expect((await as(rashid).patch(`/positions/${id}`, { name: "Hijack" })).status).toBe(404);
    expect((await as(rashid).put(`/positions/${id}/holders`, { userIds: [] })).status).toBe(404);
    expect((await as(rashid).post(`/positions/${id}/retire`)).status).toBe(404);
    expect((await as(rashid).post(`/positions/${id}/restore`)).status).toBe(404);
    expect((await as(huda).get(`/positions/${id}`)).body.position.retired).toBe(false);
  });

  it("lets two tenants use the same position name", async () => {
    const name = nextName("Shared Name");
    await createPosition(name, contracts);
    expect((await as(rashid).post("/positions", { unitId: rashidUnit, name })).status).toBe(201);
  });
});
