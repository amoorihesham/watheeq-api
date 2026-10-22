import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser } from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

// Al-Noor as in the Phase 3 spec, section 3. Sara (owner) and Lina have no unit.
const PEOPLE = {
  Sara: null,
  Lina: null,
  Huda: "Legal Affairs",
  Ahmed: "Legal Affairs",
  Faisal: "Contracts",
  Nora: "Contracts",
  Omar: "Litigation",
  Majed: "Finance",
  Reem: "Procurement",
  Khalid: "Procurement",
} as const;
type Person = keyof typeof PEOPLE;
const LEGAL_TREE: Person[] = ["Ahmed", "Faisal", "Huda", "Nora", "Omar"];
const EVERYONE = (Object.keys(PEOPLE) as Person[]).sort();

const ids = {} as Record<Person, string>;
const tokens = {} as Record<Person, string>;
const units: Record<string, string> = {};
const roleAt: Record<string, string> = {};
let alNoor = "";
let rashid = "";
let rashidKhalid = "";

const as = (person: Person) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(tokens[person])),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(tokens[person])).send(body),
});

/** Gives the person a role that grants `user.view` at `scope` (or none), straight in the database. */
const setScope = (person: Person, scope: string) =>
  pool.query("update tenant_members set role_id = $2 where user_id = $1", [
    ids[person],
    roleAt[scope],
  ]);

const visibleTo = async (person: Person): Promise<string[]> => {
  const res = await as(person).get("/users?status=all&limit=200");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(res.body.users.length);
  return res.body.users.map((user: { userName: string }) => user.userName).sort();
};

const insertUnit = async (name: string, parent: string | null) => {
  const { rows } = await pool.query<{ id: string }>(
    "insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id",
    [alNoor, parent ? "section" : "department", parent, name],
  );
  units[name] = rows[0]?.id ?? "";
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, "scope-al-noor", [
    { email: "sara@scope-alnoor.test", userName: "Sara", passwordHash },
  ]);
  alNoor = tenant.id;
  ids.Sara = tenant.userIds[0] ?? "";
  await insertUnit("Legal Affairs", null);
  await insertUnit("Contracts", units["Legal Affairs"] ?? null);
  await insertUnit("Litigation", units["Legal Affairs"] ?? null);
  await insertUnit("Finance", null);
  await insertUnit("Procurement", units.Finance ?? null);

  const viewAt = (scope: string) => ({
    name: `View ${scope}`,
    permissions: [
      { key: "org.view", scope: "organization" },
      { key: "user.view", scope },
      { key: "role.assign", scope: "organization" },
    ],
  });
  for (const scope of ["own", "section", "department", "organization"]) {
    roleAt[scope] = await seedRole(pool, alNoor, viewAt(scope));
  }
  // Holds no user.view; only reachable with a token issued before the grant was removed.
  roleAt.none = await seedRole(pool, alNoor, {
    name: "No View",
    permissions: [{ key: "org.view", scope: "organization" }],
  });

  for (const [person, unit] of Object.entries(PEOPLE) as [Person, string | null][]) {
    if (person !== "Sara") {
      ids[person] = await seedUser(pool, {
        email: `${person.toLowerCase()}@scope-alnoor.test`,
        userName: person,
        passwordHash,
      });
      await pool.query(
        "insert into tenant_members (tenant_id, user_id, role_id, unit_id) values ($1, $2, $3, $4)",
        [alNoor, ids[person], roleAt.organization, unit ? units[unit] : null],
      );
    }
    tokens[person] = (
      await login(app, `${person.toLowerCase()}@scope-alnoor.test`, PASSWORD)
    ).access;
  }

  const other = await seedSubscribedTenant(pool, "scope-al-rashid", [
    { email: "admin@scope-alrashid.test", passwordHash },
    { email: "khalid@scope-alrashid.test", userName: "Khalid of Al-Rashid", passwordHash },
  ]);
  rashidKhalid = other.userIds[1] ?? "";
  rashid = (await login(app, "admin@scope-alrashid.test", PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("the user directory follows the caller's user.view scope (R3.14, R3.15)", () => {
  it.each<[Person, string, Person[]]>([
    ["Nora", "organization", EVERYONE],
    ["Nora", "department", LEGAL_TREE],
    ["Nora", "section", ["Faisal", "Nora"]],
    ["Nora", "own", ["Nora"]],
    ["Ahmed", "department", LEGAL_TREE],
    ["Ahmed", "section", ["Ahmed", "Huda"]],
    ["Khalid", "department", ["Khalid", "Majed", "Reem"]],
    ["Omar", "section", ["Omar"]],
    ["Lina", "department", ["Lina"]],
    ["Lina", "section", ["Lina"]],
    ["Lina", "organization", EVERYONE],
  ])("%s at %s scope sees %j", async (person, scope, expected) => {
    await setScope(person, scope);
    try {
      expect(await visibleTo(person)).toEqual([...expected].sort());
    } finally {
      await setScope(person, "organization");
    }
  });

  it("shows members with no unit only at organization scope", async () => {
    await setScope("Huda", "department");
    try {
      const seen = await visibleTo("Huda");
      expect(seen).not.toContain("Sara");
      expect(seen).not.toContain("Lina");
    } finally {
      await setScope("Huda", "organization");
    }
  });

  it("answers 404 for a user outside the scope, and keeps filters within it", async () => {
    await setScope("Faisal", "department");
    try {
      expect((await as("Faisal").get(`/users/${ids.Nora}`)).status).toBe(200);
      expect((await as("Faisal").get(`/users/${ids.Khalid}`)).status).toBe(404);
      expect((await as("Faisal").get(`/users/${ids.Sara}`)).status).toBe(404);
      const inProcurement = await as("Faisal").get(`/users?unitId=${units.Procurement}`);
      expect(inProcurement.body).toMatchObject({ users: [], total: 0 });
      const search = await as("Faisal").get("/users?q=a&status=all");
      expect(search.body.users.map((user: { userName: string }) => user.userName)).not.toContain(
        "Majed",
      );
    } finally {
      await setScope("Faisal", "organization");
    }
  });

  it("gives a caller whose role lost user.view nothing, not even themselves", async () => {
    await setScope("Reem", "none");
    try {
      const res = await as("Reem").get("/users?status=all");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ users: [], total: 0 });
      expect((await as("Reem").get(`/users/${ids.Reem}`)).status).toBe(404);
    } finally {
      await setScope("Reem", "organization");
    }
  });

  it("gives a deactivated caller with a live token nothing", async () => {
    await pool.query("update users set is_active = false where id = $1", [ids.Majed]);
    try {
      expect((await as("Majed").get("/users")).body.total).toBe(0);
    } finally {
      await pool.query("update users set is_active = true where id = $1", [ids.Majed]);
    }
  });

  it("never shows another tenant's users", async () => {
    expect(await visibleTo("Sara")).not.toContain("Khalid of Al-Rashid");
    expect((await as("Sara").get(`/users/${rashidKhalid}`)).status).toBe(404);
    const res = await request(app).get(`/users/${ids.Khalid}`).set("Cookie", accessCookie(rashid));
    expect(res.status).toBe(404);
  });
});

describe("scope follows the structure immediately (R3.16)", () => {
  it("reflects a move on the next request, with the same token", async () => {
    await setScope("Nora", "department");
    try {
      expect(await visibleTo("Nora")).toEqual(LEGAL_TREE);
      await pool.query("update tenant_members set unit_id = $2 where user_id = $1", [
        ids.Nora,
        units.Procurement,
      ]);
      expect(await visibleTo("Nora")).toEqual(["Khalid", "Majed", "Nora", "Reem"]);
    } finally {
      await pool.query("update tenant_members set unit_id = $2 where user_id = $1", [
        ids.Nora,
        units.Contracts,
      ]);
      await setScope("Nora", "organization");
    }
  });

  it("reflects a role edit on the next request, with the same token", async () => {
    await setScope("Faisal", "department");
    try {
      expect((await visibleTo("Faisal")).length).toBe(LEGAL_TREE.length);
      await pool.query(
        "update role_permissions set scope = 'own' where role_id = $1 and permission = 'user.view'",
        [roleAt.department],
      );
      expect(await visibleTo("Faisal")).toEqual(["Faisal"]);
    } finally {
      await pool.query(
        "update role_permissions set scope = 'department' where role_id = $1 and permission = 'user.view'",
        [roleAt.department],
      );
      await setScope("Faisal", "organization");
    }
  });

  it("reflects a section moving to another department", async () => {
    await setScope("Khalid", "department");
    try {
      await pool.query("update org_units set parent_id = $2 where id = $1", [
        units.Procurement,
        units["Legal Affairs"],
      ]);
      expect(await visibleTo("Khalid")).toEqual([...LEGAL_TREE, "Khalid", "Reem"].sort());
    } finally {
      await pool.query("update org_units set parent_id = $2 where id = $1", [
        units.Procurement,
        units.Finance,
      ]);
      await setScope("Khalid", "organization");
    }
  });
});

describe("role assignment reaches only users within the caller's scope (step 3.4)", () => {
  it("assigns within the scope and answers 404 outside it", async () => {
    await setScope("Faisal", "department");
    // Both of Omar's roles must be within Faisal's grants too (R3.10).
    await setScope("Omar", "section");
    try {
      const inside = await as("Faisal").put(`/users/${ids.Omar}/role`, {
        roleId: roleAt.own,
      });
      expect(inside.status).toBe(200);
      const outside = await as("Faisal").put(`/users/${ids.Khalid}/role`, {
        roleId: roleAt.own,
      });
      expect(outside.status).toBe(404);
      const { rows } = await pool.query("select role_id from tenant_members where user_id = $1", [
        ids.Khalid,
      ]);
      expect(rows[0].role_id).toBe(roleAt.organization);
    } finally {
      await setScope("Omar", "organization");
      await setScope("Faisal", "organization");
    }
  });
});
