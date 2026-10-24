import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  connectToTestDb,
  seedSubscribedTenant,
  seedTenant,
  waitUntilBlockedOn,
} from "./helpers/db.js";

const PASSWORD = "correct horse battery staple";
const SARA = "sara@ou-alnoor.test";
const KHALID = "khalid@ou-alnoor.test";
const RASHID_ADMIN = "admin@ou-alrashid.test";

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let sara = "";
let khalid = "";
let rashid = "";
let alNoor = "";
let khalidId = "";

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  delete: (path: string) => request(app).delete(path).set("Cookie", accessCookie(access)),
});

/** Creates a unit as Sara and returns its id. */
async function unit(name: string, parentId?: string): Promise<string> {
  const res = await as(sara).post("/org-units", parentId ? { name, parentId } : { name });
  expect(res.status).toBe(201);
  return res.body.unit.id;
}

const placeKhalid = (unitId: string | null) =>
  pool.query("update tenant_members set unit_id = $2 where user_id = $1", [khalidId, unitId]);

const auditRows = (resourceId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_type, details from audit_log where resource_id = $1 order by id",
      [resourceId],
    )
    .then((result) => result.rows);

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(pool, "ou-al-noor", [
    { email: SARA, passwordHash },
    { email: KHALID, passwordHash },
  ]);
  alNoor = tenant.id;
  khalidId = tenant.userIds[1] ?? "";
  await seedSubscribedTenant(pool, "ou-al-rashid", [{ email: RASHID_ADMIN, passwordHash }]);
  sara = (await login(app, SARA, PASSWORD)).access;
  khalid = (await login(app, KHALID, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("a new tenant (R2.1)", () => {
  it("starts with no units and every member at the organization level", async () => {
    const res = await as(rashid).get("/org-units");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ organization: { memberCount: 1 }, departments: [] });
  });
});

describe("creating units (R2.2, R2.3)", () => {
  it("creates a department, then a section under it, and audits both", async () => {
    const finance = await as(sara).post("/org-units", { name: "  Finance  " });
    expect(finance.status).toBe(201);
    expect(finance.body.unit).toMatchObject({
      kind: "department",
      parentId: null,
      name: "Finance",
    });
    const procurement = await as(sara).post("/org-units", {
      name: "Procurement",
      parentId: finance.body.unit.id,
    });
    expect(procurement.status).toBe(201);
    expect(procurement.body.unit).toMatchObject({
      kind: "section",
      parentId: finance.body.unit.id,
    });
    expect(await auditRows(procurement.body.unit.id)).toEqual([
      {
        action: "org_unit.created",
        tenant_id: alNoor,
        actor_type: "user",
        details: { name: "Procurement", kind: "section", parentId: finance.body.unit.id },
      },
    ]);
  });

  it("refuses a unit under a section", async () => {
    const legal = await unit("Legal Affairs");
    const contracts = await unit("Contracts", legal);
    const res = await as(sara).post("/org-units", { name: "Drafting", parentId: contracts });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "parentId", code: "parent_not_department" }]);
  });

  it("refuses a parent that does not exist or belongs to another tenant", async () => {
    const rashidHr = (await as(rashid).post("/org-units", { name: "HR" })).body.unit.id;
    for (const parentId of [rashidHr, "00000000-0000-4000-8000-000000000000"]) {
      const res = await as(sara).post("/org-units", { name: "Payroll", parentId });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "parentId", code: "unknown_unit" }]);
    }
  });

  it("refuses a second department with the same name in any case", async () => {
    await unit("Operations");
    const res = await as(sara).post("/org-units", { name: "OPERATIONS" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UNIT_NAME_TAKEN");
  });

  it("allows the same section name under different departments, but not twice in one", async () => {
    const audit = await unit("Audit");
    const risk = await unit("Risk");
    await unit("Reporting", audit);
    await unit("reporting", risk);
    const res = await as(sara).post("/org-units", { name: "REPORTING", parentId: audit });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UNIT_NAME_TAKEN");
  });

  it("lets another tenant reuse a name", async () => {
    await unit("Shared Name");
    expect((await as(rashid).post("/org-units", { name: "Shared Name" })).status).toBe(201);
  });

  it("accepts Arabic names and treats them as unique", async () => {
    await unit("الشؤون القانونية");
    const res = await as(sara).post("/org-units", { name: "الشؤون القانونية" });
    expect(res.status).toBe(409);
  });

  it("refuses an empty, blank, or over-long name", async () => {
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect((await as(sara).post("/org-units", { name })).status).toBe(400);
    }
  });
});

describe("the tree (R2.15)", () => {
  it("nests sections under departments, orders by name, and counts members", async () => {
    const tenant = await seedSubscribedTenant(pool, "ou-tree", [
      { email: "admin@ou-tree.test", passwordHash: await hashPassword(PASSWORD) },
      { email: "member@ou-tree.test" },
    ]);
    const admin = (await login(app, "admin@ou-tree.test", PASSWORD)).access;
    const create = async (name: string, parentId?: string) =>
      (await as(admin).post("/org-units", parentId ? { name, parentId } : { name })).body.unit.id;
    const legal = await create("legal");
    const finance = await create("Finance");
    const procurement = await create("Procurement", finance);
    const budgeting = await create("budgeting", finance);
    await pool.query("update tenant_members set unit_id = $2 where user_id = $1", [
      tenant.userIds[1],
      procurement,
    ]);
    const res = await as(admin).get("/org-units");
    expect(res.body).toEqual({
      organization: { memberCount: 1 },
      departments: [
        {
          id: finance,
          name: "Finance",
          managers: [],
          memberCount: 0,
          sections: [
            { id: budgeting, name: "budgeting", managers: [], memberCount: 0 },
            { id: procurement, name: "Procurement", managers: [], memberCount: 1 },
          ],
        },
        { id: legal, name: "legal", managers: [], memberCount: 0, sections: [] },
      ],
    });
  });

  it("lets a member read the tree but not change it", async () => {
    expect((await as(khalid).get("/org-units")).status).toBe(200);
    const res = await as(khalid).post("/org-units", { name: "Khalid's Department" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("never shows another tenant's units", async () => {
    const res = await as(rashid).get("/org-units");
    const names = res.body.departments.map((department: { name: string }) => department.name);
    expect(names).not.toContain("Finance");
  });
});

describe("renaming and moving (R2.4)", () => {
  it("renames a unit and audits before and after", async () => {
    const hr = await unit("Human Resources");
    const res = await as(sara).patch(`/org-units/${hr}`, { name: "People" });
    expect(res.status).toBe(200);
    expect(res.body.unit.name).toBe("People");
    const [, updated] = await auditRows(hr);
    expect(updated).toMatchObject({
      action: "org_unit.updated",
      details: {
        before: { name: "Human Resources", parentId: null },
        after: { name: "People", parentId: null },
      },
    });
  });

  it("moves a section, with its members, to another department", async () => {
    const sales = await unit("Sales");
    const marketing = await unit("Marketing");
    const field = await unit("Field", sales);
    await placeKhalid(field);
    const res = await as(sara).patch(`/org-units/${field}`, { parentId: marketing });
    expect(res.status).toBe(200);
    expect(res.body.unit.parentId).toBe(marketing);
    const { rows } = await pool.query("select unit_id from tenant_members where user_id = $1", [
      khalidId,
    ]);
    expect(rows[0].unit_id).toBe(field);
    await placeKhalid(null);
  });

  it("never turns a department into a section, or a section into a department", async () => {
    const parent = await unit("Parent Department");
    const other = await unit("Other Department");
    const section = await unit("A Section", parent);
    const asSection = await as(sara).patch(`/org-units/${other}`, { parentId: parent });
    expect(asSection.status).toBe(400);
    expect(asSection.body.error.details).toEqual([
      { path: "parentId", code: "department_has_no_parent" },
    ]);
    expect((await as(sara).patch(`/org-units/${section}`, { parentId: null })).status).toBe(400);
  });

  it("refuses moving a section under a section", async () => {
    const dept = await unit("Moves Department");
    const first = await unit("First", dept);
    const second = await unit("Second", dept);
    const res = await as(sara).patch(`/org-units/${second}`, { parentId: first });
    expect(res.body.error.details).toEqual([{ path: "parentId", code: "parent_not_department" }]);
  });

  it("refuses a rename onto a sibling's name and an empty body", async () => {
    const a = await unit("Alpha");
    await unit("Beta");
    expect((await as(sara).patch(`/org-units/${a}`, { name: "beta" })).body.error.code).toBe(
      "UNIT_NAME_TAKEN",
    );
    expect((await as(sara).patch(`/org-units/${a}`, {})).status).toBe(400);
  });

  it("answers 404 for another tenant's unit, an unknown id, and a non-UUID (R2.19)", async () => {
    const rashidUnit = (await as(rashid).post("/org-units", { name: "Rashid Only" })).body.unit.id;
    for (const id of [rashidUnit, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await as(sara).patch(`/org-units/${id}`, { name: "Taken Over" })).status).toBe(404);
      expect((await as(sara).delete(`/org-units/${id}`)).status).toBe(404);
    }
    expect((await as(rashid).get("/org-units")).body.departments).toContainEqual(
      expect.objectContaining({ id: rashidUnit, name: "Rashid Only" }),
    );
  });
});

describe("deleting (R2.5)", () => {
  it("deletes an empty unit and audits it", async () => {
    const temp = await unit("Temporary");
    expect((await as(sara).delete(`/org-units/${temp}`)).status).toBe(204);
    expect((await auditRows(temp)).at(-1)).toMatchObject({
      action: "org_unit.deleted",
      details: { name: "Temporary", kind: "department", parentId: null },
    });
  });

  it("refuses a department that still has sections", async () => {
    const dept = await unit("Has Sections");
    await unit("Child", dept);
    const res = await as(sara).delete(`/org-units/${dept}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UNIT_NOT_EMPTY");
  });

  it("refuses a unit with a member, even an inactive one", async () => {
    const dept = await unit("Has Members");
    await placeKhalid(dept);
    await pool.query("update users set is_active = false where id = $1", [khalidId]);
    expect((await as(sara).delete(`/org-units/${dept}`)).body.error.code).toBe("UNIT_NOT_EMPTY");
    await pool.query("update users set is_active = true where id = $1", [khalidId]);
    await placeKhalid(null);
    expect((await as(sara).delete(`/org-units/${dept}`)).status).toBe(204);
  });

  it("waits for a section being created under the department, then refuses the delete", async () => {
    const dept = await unit("Racing Department");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into org_units (tenant_id, kind, parent_id, name) values ($1, 'section', $2, 'Late Section')",
        [alNoor, dept],
      );
      const deletion = as(sara)
        .delete(`/org-units/${dept}`)
        .then((res) => res);
      await waitUntilBlockedOn(pool, "org_units");
      await client.query("commit");
      const res = await deletion;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("UNIT_NOT_EMPTY");
    } finally {
      client.release();
    }
  });

  it("makes a section created during a delete fail with unknown_unit", async () => {
    const dept = await unit("Vanishing Department");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from org_units where id = $1 for update", [dept]);
      const creation = as(sara)
        .post("/org-units", { name: "Orphan", parentId: dept })
        .then((res) => res);
      await waitUntilBlockedOn(pool, "org_units");
      await client.query("delete from org_units where id = $1", [dept]);
      await client.query("commit");
      const res = await creation;
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "parentId", code: "unknown_unit" }]);
    } finally {
      client.release();
    }
  });
});

describe("tenant isolation in the database (P2.2)", () => {
  it("refuses a member placed in another tenant's unit, even by a query that forgets the filter", async () => {
    const other = await seedTenant(pool, "ou-other", [{ email: "x@ou-other.test" }]);
    const rashidUnit = (await as(rashid).post("/org-units", { name: "Rashid Unit" })).body.unit.id;
    await expect(
      pool.query("update tenant_members set unit_id = $2 where tenant_id = $1", [
        other.id,
        rashidUnit,
      ]),
    ).rejects.toThrow(/tenant_members_unit_fk/);
  });

  it("refuses a section under another tenant's department", async () => {
    const rashidDept = (await as(rashid).post("/org-units", { name: "Rashid Dept" })).body.unit.id;
    await expect(
      pool.query(
        "insert into org_units (tenant_id, kind, parent_id, name) values ($1, 'section', $2, 'Smuggled')",
        [alNoor, rashidDept],
      ),
    ).rejects.toThrow(/org_units_parent_fk/);
  });

  it("refuses a department with a parent or a section without one", async () => {
    await expect(
      pool.query("insert into org_units (tenant_id, kind, name) values ($1, 'section', 'Loose')", [
        alNoor,
      ]),
    ).rejects.toThrow(/org_units_shape/);
  });
});
