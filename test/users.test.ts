import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login, refreshCookie } from "./helpers/auth.js";
import { TEST_APP_BASE_URL } from "./helpers/config.js";
import { connectToTestDb, seedRole, seedSubscribedTenant, seedUser } from "./helpers/db.js";
import { createFakeEmailSender } from "./helpers/email.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const SARA = "sara@us-alnoor.test";
const MAJED = "majed@us-alnoor.test";
const KHALID = "khalid@us-alnoor.test";
const RASHID_ADMIN = "admin@us-alrashid.test";
const HUDA = "huda.legal@us-alnoor.test";

const pool = connectToTestDb();
const email = createFakeEmailSender();
const app = testApp(pool, createLogger("silent"), { emailSender: email.sender });

let sara = "";
let majed = "";
let khalid = "";
let rashid = "";
let alNoor = "";
let adminRoleId = "";
let memberRoleId = "";
let rashidRoleId = "";
let legalAdminRoleId = "";
let employeeRoleId = "";
let huda = "";
let saraId = "";
let majedId = "";
let khalidId = "";
let finance = "";
let procurement = "";
let legal = "";
let rashidUnit = "";
let counter = 0;

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
});

const nextEmail = () => `user${++counter}@us-alnoor.test`;
const adminRole = () => ({ id: adminRoleId, name: "Tenant Admin", isSystem: true });
const memberRole = () => ({ id: memberRoleId, name: "Member", isSystem: false });
const org = (key: string) => ({ key, scope: "organization" });

/** Invites a user into Al-Noor as Sara; returns their id. */
async function invite(body: Record<string, unknown> = {}): Promise<string> {
  const res = await as(sara).post("/users", {
    email: nextEmail(),
    userName: `User ${counter}`,
    roleId: memberRoleId,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body.user.id;
}

/** Invites a user and has them set a password, as following the emailed link does. */
async function inviteActive(
  body: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> {
  const address = nextEmail();
  const id = await invite({ email: address, ...body });
  const res = await request(app)
    .post("/auth/verify")
    .send({ token: email.lastTokenFor(address), password: PASSWORD });
  expect(res.status).toBe(204);
  return { id, email: address };
}

const auditOf = (userId: string) =>
  pool
    .query(
      "select action, tenant_id, actor_id, details from audit_log where resource_id = $1 order by id",
      [userId],
    )
    .then((result) => result.rows);

const unitOf = (name: string, parentId?: string) =>
  as(sara)
    .post("/org-units", parentId ? { name, parentId } : { name })
    .then((res) => res.body.unit.id as string);

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await seedSubscribedTenant(
    pool,
    "us-al-noor",
    [
      { email: SARA, userName: "Sara", passwordHash },
      { email: MAJED, userName: "Majed", passwordHash },
      { email: KHALID, userName: "Khalid", passwordHash },
    ],
    200,
  );
  ({ id: alNoor, adminRoleId, memberRoleId } = tenant);
  [saraId = "", majedId = "", khalidId = ""] = tenant.userIds;
  await pool.query("update tenant_members set role_id = $2 where user_id = $1", [
    majedId,
    adminRoleId,
  ]);
  ({ memberRoleId: rashidRoleId } = await seedSubscribedTenant(pool, "us-al-rashid", [
    { email: RASHID_ADMIN, passwordHash },
  ]));
  // Huda administers people for Legal: she can invite, deactivate, and assign roles, but not everything.
  legalAdminRoleId = await seedRole(pool, alNoor, {
    name: "Legal Admin",
    permissions: [
      "org.view",
      "user.view",
      "user.create",
      "user.deactivate",
      "role.view",
      "role.assign",
    ].map(org),
  });
  employeeRoleId = await seedRole(pool, alNoor, {
    name: "Employee",
    permissions: [org("org.view")],
  });
  const hudaId = await seedUser(pool, { email: HUDA, userName: "Huda", passwordHash });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    alNoor,
    hudaId,
    legalAdminRoleId,
  ]);
  sara = (await login(app, SARA, PASSWORD)).access;
  majed = (await login(app, MAJED, PASSWORD)).access;
  khalid = (await login(app, KHALID, PASSWORD)).access;
  rashid = (await login(app, RASHID_ADMIN, PASSWORD)).access;
  huda = (await login(app, HUDA, PASSWORD)).access;
  finance = await unitOf("Finance");
  procurement = await unitOf("Procurement", finance);
  legal = await unitOf("Legal Affairs");
  rashidUnit = (await as(rashid).post("/org-units", { name: "Rashid Unit" })).body.unit.id;
});

afterAll(async () => {
  await pool.end();
});

describe("inviting a user (R2.8)", () => {
  it("creates an invited user in a unit, emails the link, and audits it", async () => {
    const res = await as(sara).post("/users", {
      email: "  Huda@US-AlNoor.test ",
      userName: "Huda",
      unitId: legal,
      isManager: true,
      roleId: memberRoleId,
    });
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.user).toMatchObject({
      email: "huda@us-alnoor.test",
      userName: "Huda",
      unit: { id: legal, name: "Legal Affairs", kind: "department" },
      isManager: true,
      role: memberRole(),
      isOwner: false,
      status: "invited",
    });
    const message = email.sent.filter((m) => m.to === "huda@us-alnoor.test").at(-1);
    expect(message?.text).toContain("Sara invited you to join us-al-noor");
    expect(message?.text).toContain(`${TEST_APP_BASE_URL}/verify-email?token=`);
    expect(await auditOf(res.body.user.id)).toEqual([
      {
        action: "user.invited",
        tenant_id: alNoor,
        actor_id: saraId,
        details: {
          email: "huda@us-alnoor.test",
          userName: "Huda",
          unitId: legal,
          isManager: true,
          roleId: memberRoleId,
          roleName: "Member",
        },
      },
    ]);
  });

  it("lets the invited user set a password and log in; Sara never sees it", async () => {
    const { id, email: address } = await inviteActive({ unitId: procurement });
    const session = await login(app, address, PASSWORD);
    expect(session.res.status).toBe(200);
    expect(session.res.body.user.tenant).toMatchObject({ id: alNoor, roleId: memberRoleId });
    expect((await as(sara).get(`/users/${id}`)).body.user.status).toBe("active");
  });

  it("places a user directly under the organization when no unit is given (R2.10)", async () => {
    const id = await invite();
    expect((await as(sara).get(`/users/${id}`)).body.user.unit).toBeNull();
  });

  it("refuses an email that is already taken, in this or another tenant, and leaves nothing behind", async () => {
    for (const taken of [KHALID, RASHID_ADMIN]) {
      const res = await as(sara).post("/users", {
        email: taken,
        userName: "Duplicate Invitee",
        roleId: memberRoleId,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TAKEN");
      expect(res.body.error.details).toEqual([{ path: "email", code: "taken" }]);
    }
    const { rows } = await pool.query(
      "select count(*)::int as n from users where user_name = 'Duplicate Invitee'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses a unit of another tenant or an unknown one", async () => {
    for (const unitId of [rashidUnit, "00000000-0000-4000-8000-000000000000"]) {
      const res = await as(sara).post("/users", {
        email: nextEmail(),
        userName: "X",
        unitId,
        roleId: memberRoleId,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "unitId", code: "unknown_unit" }]);
    }
  });

  it("refuses a manager without a unit", async () => {
    const res = await as(sara).post("/users", {
      email: nextEmail(),
      userName: "X",
      isManager: true,
      roleId: memberRoleId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "isManager", code: "manager_needs_unit" }]);
  });

  it("refuses a malformed role, a missing role or name, and a bad email", async () => {
    const bodies = [
      { email: nextEmail(), userName: "X", roleId: "member" },
      { email: nextEmail(), userName: "X" },
      { email: nextEmail(), roleId: memberRoleId },
      { email: "not-an-email", userName: "X", roleId: memberRoleId },
    ];
    for (const body of bodies) {
      expect((await as(sara).post("/users", body)).status).toBe(400);
    }
  });

  it("refuses a role of another tenant or an unknown one (R3.18)", async () => {
    for (const roleId of [rashidRoleId, "00000000-0000-4000-8000-000000000000"]) {
      const res = await as(sara).post("/users", { email: nextEmail(), userName: "X", roleId });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "roleId", code: "unknown_role" }]);
    }
  });

  it("refuses a member (R2.15)", async () => {
    const res = await as(khalid).post("/users", {
      email: nextEmail(),
      userName: "X",
      roleId: memberRoleId,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("still creates the user when the email fails, and the admin can resend", async () => {
    const address = nextEmail();
    email.failNext();
    const res = await as(sara).post("/users", {
      email: address,
      userName: "Unlucky",
      roleId: memberRoleId,
    });
    expect(res.status).toBe(201);
    expect(email.lastTokenFor(address)).toBe("");
    expect((await as(sara).post(`/users/${res.body.user.id}/resend-invitation`)).status).toBe(204);
    expect(email.lastTokenFor(address)).not.toBe("");
  });
});

describe("seats (R2.9)", () => {
  it("refuses an invitation at the limit, and gives the last seat to one of two concurrent invitations", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const { memberRoleId: smallRoleId } = await seedSubscribedTenant(
      pool,
      "us-small",
      [{ email: "admin@us-small.test", passwordHash }],
      3,
    );
    const admin = (await login(app, "admin@us-small.test", PASSWORD)).access;
    const inviteInto = (n: number) =>
      as(admin).post("/users", {
        email: `u${n}@us-small.test`,
        userName: `U${n}`,
        roleId: smallRoleId,
      });
    expect((await inviteInto(1)).status).toBe(201);
    const results = await Promise.all([inviteInto(2), inviteInto(3)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409)?.body.error.code).toBe("USER_LIMIT_REACHED");
    const full = await inviteInto(4);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("USER_LIMIT_REACHED");
  });
});

describe("listing and viewing (R2.15)", () => {
  let prefix = "";

  beforeAll(async () => {
    prefix = `List${Date.now()}`;
    const zed = await inviteActive({
      userName: `${prefix} zed`,
      unitId: procurement,
      isManager: true,
    });
    await inviteActive({ userName: `${prefix} Alpha`, unitId: procurement });
    await invite({ userName: `${prefix} Pending` });
    const leaver = await inviteActive({ userName: `${prefix} Leaver` });
    await as(sara).post(`/users/${leaver.id}/deactivate`);
    await inviteActive({ userName: `${prefix} 100%_done` });
    expect(zed).toBeTruthy();
  });

  const names = (res: request.Response) =>
    res.body.users.map((user: { userName: string }) => user.userName);

  it("lists active users by default, ordered by name, with the total", async () => {
    const res = await as(sara).get(`/users?q=${prefix}`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual([`${prefix} 100%_done`, `${prefix} Alpha`, `${prefix} zed`]);
    expect(res.body.total).toBe(3);
  });

  it("filters by status", async () => {
    expect(names(await as(sara).get(`/users?q=${prefix}&status=invited`))).toEqual([
      `${prefix} Pending`,
    ]);
    expect(names(await as(sara).get(`/users?q=${prefix}&status=inactive`))).toEqual([
      `${prefix} Leaver`,
    ]);
    expect((await as(sara).get(`/users?q=${prefix}&status=all`)).body.total).toBe(5);
  });

  it("filters by unit, organization level, and manager flag", async () => {
    expect(names(await as(sara).get(`/users?q=${prefix}&unitId=${procurement}`))).toEqual([
      `${prefix} Alpha`,
      `${prefix} zed`,
    ]);
    expect(names(await as(sara).get(`/users?q=${prefix}&unitId=none`))).toEqual([
      `${prefix} 100%_done`,
    ]);
    expect(names(await as(sara).get(`/users?q=${prefix}&managers=true`))).toEqual([
      `${prefix} zed`,
    ]);
  });

  it("searches name and email ignoring case, and matches % and _ literally", async () => {
    expect((await as(sara).get(`/users?q=${prefix.toLowerCase()}%20ALPHA`)).body.total).toBe(1);
    expect(names(await as(sara).get(`/users?q=${encodeURIComponent("100%_")}`))).toEqual([
      `${prefix} 100%_done`,
    ]);
    expect((await as(sara).get("/users?q=sara@us-alnoor")).body.users[0].email).toBe(SARA);
  });

  it("pages with limit and offset", async () => {
    const page = await as(sara).get(`/users?q=${prefix}&limit=2&offset=1`);
    expect(names(page)).toEqual([`${prefix} Alpha`, `${prefix} zed`]);
    expect(page.body.total).toBe(3);
  });

  it("refuses an out-of-range limit or an unknown status", async () => {
    expect((await as(sara).get("/users?limit=500")).status).toBe(400);
    expect((await as(sara).get("/users?status=gone")).status).toBe(400);
  });

  it("lets a member read the directory (Q5)", async () => {
    expect((await as(khalid).get(`/users?q=${prefix}`)).body.total).toBe(3);
    expect((await as(khalid).get(`/users/${saraId}`)).body.user).toMatchObject({
      email: SARA,
      isOwner: true,
      role: adminRole(),
    });
  });

  it("never shows another tenant's users (R2.19)", async () => {
    const res = await as(rashid).get("/users?status=all");
    expect(res.body.users.map((user: { email: string }) => user.email)).toEqual([RASHID_ADMIN]);
    for (const id of [saraId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await as(rashid).get(`/users/${id}`)).status).toBe(404);
      expect((await as(rashid).patch(`/users/${id}`, { userName: "Taken" })).status).toBe(404);
      expect((await as(rashid).post(`/users/${id}/deactivate`)).status).toBe(404);
    }
  });
});

describe("editing (R2.11, R2.13, R2.18)", () => {
  it("renames and moves, auditing only what changed", async () => {
    const id = await invite({ userName: "Before", unitId: procurement });
    const res = await as(sara).patch(`/users/${id}`, { userName: "After", unitId: finance });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      userName: "After",
      unit: { id: finance, kind: "department" },
      role: memberRole(),
    });
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "user.updated",
      actor_id: saraId,
      details: {
        before: { userName: "Before", unitId: procurement },
        after: { userName: "After", unitId: finance },
      },
    });
  });

  it("names a field it does not accept, such as a role (P3.12), and changes nothing", async () => {
    const id = await invite({ userName: "Kept" });
    const res = await as(sara).patch(`/users/${id}`, { userName: "Kept 2", roleId: adminRoleId });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "roleId", code: "unknown_field" }]);
    expect((await as(sara).get(`/users/${id}`)).body.user).toMatchObject({
      userName: "Kept",
      role: memberRole(),
    });
  });

  it("writes no audit entry when nothing changes", async () => {
    const id = await invite({ userName: "Same" });
    const before = (await auditOf(id)).length;
    expect((await as(sara).patch(`/users/${id}`, { userName: "Same" })).status).toBe(200);
    expect((await auditOf(id)).length).toBe(before);
  });

  it("allows one's own name and unit", async () => {
    const rename = await as(majed).patch(`/users/${majedId}`, {
      userName: "Majed",
      unitId: finance,
    });
    expect(rename.status).toBe(200);
    await as(majed).patch(`/users/${majedId}`, { unitId: null });
  });

  it("refuses an unknown unit and an empty body", async () => {
    const id = await invite();
    const unknown = await as(sara).patch(`/users/${id}`, { unitId: rashidUnit });
    expect(unknown.body.error.details).toEqual([{ path: "unitId", code: "unknown_unit" }]);
    const empty = await as(sara).patch(`/users/${id}`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details).toEqual([{ path: "", code: "no_fields" }]);
  });

  it("refuses a member", async () => {
    expect((await as(khalid).patch(`/users/${khalidId}`, { userName: "K" })).status).toBe(403);
  });
});

describe("managers (R2.6, R2.7)", () => {
  const treeManagers = async (unitId: string) => {
    const tree = (await as(sara).get("/org-units")).body;
    const units = tree.departments.flatMap((department: { sections: unknown[] }) => [
      department,
      ...department.sections,
    ]);
    return units
      .find((unit: { id: string }) => unit.id === unitId)
      .managers.map((manager: { userName: string }) => manager.userName);
  };

  it("lets a unit have several managers, all shown in the tree, or none", async () => {
    const audit = await unitOf("Internal Audit");
    await inviteActive({ userName: "Manager Two", unitId: audit, isManager: true });
    await inviteActive({ userName: "Manager One", unitId: audit, isManager: true });
    await inviteActive({ userName: "Plain Member", unitId: audit });
    expect(await treeManagers(audit)).toEqual(["Manager One", "Manager Two"]);
    expect(await treeManagers(await unitOf("Vacant"))).toEqual([]);
  });

  it("marks and unmarks a manager", async () => {
    const unit = await unitOf("Treasury");
    const { id } = await inviteActive({ userName: "Faisal", unitId: unit });
    expect((await as(sara).patch(`/users/${id}`, { isManager: true })).body.user.isManager).toBe(
      true,
    );
    expect(await treeManagers(unit)).toEqual(["Faisal"]);
    expect((await as(sara).patch(`/users/${id}`, { isManager: false })).body.user.isManager).toBe(
      false,
    );
    expect(await treeManagers(unit)).toEqual([]);
  });

  it("ends the manager role on a move, and audits it", async () => {
    const contracts = await unitOf("Contracts", legal);
    const litigation = await unitOf("Litigation", legal);
    const { id } = await inviteActive({ userName: "Mover", unitId: contracts, isManager: true });
    const res = await as(sara).patch(`/users/${id}`, { unitId: litigation });
    expect(res.body.user).toMatchObject({ unit: { id: litigation }, isManager: false });
    expect(await treeManagers(contracts)).toEqual([]);
    expect((await auditOf(id)).at(-1).details).toEqual({
      before: { unitId: contracts, isManager: true },
      after: { unitId: litigation, isManager: false },
    });
  });

  it("keeps the manager role on a move when the same request sets it", async () => {
    const from = await unitOf("From Unit");
    const to = await unitOf("To Unit");
    const { id } = await inviteActive({ unitId: from, isManager: true });
    const res = await as(sara).patch(`/users/${id}`, { unitId: to, isManager: true });
    expect(res.body.user).toMatchObject({ unit: { id: to }, isManager: true });
  });

  it("refuses a manager at the organization level, in the API and in the database", async () => {
    const { id } = await inviteActive();
    const res = await as(sara).patch(`/users/${id}`, { isManager: true });
    expect(res.body.error.details).toEqual([{ path: "isManager", code: "manager_needs_unit" }]);
    await expect(
      pool.query("update tenant_members set is_manager = true where user_id = $1", [id]),
    ).rejects.toThrow(/tenant_members_manager_has_unit/);
  });

  it("moves a manager to the organization level as a plain member", async () => {
    const unit = await unitOf("Leaving Unit");
    const { id } = await inviteActive({ unitId: unit, isManager: true });
    const res = await as(sara).patch(`/users/${id}`, { unitId: null });
    expect(res.body.user).toMatchObject({ unit: null, isManager: false });
  });
});

describe("assigning a role (R3.3, R3.9-R3.11, R3.17)", () => {
  const assign = (access: string, userId: string, roleId: string) =>
    as(access).put(`/users/${userId}/role`, { roleId });

  it("gives a user another role and audits the names before and after", async () => {
    const id = await invite();
    const res = await assign(sara, id, employeeRoleId);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.user.role).toEqual({ id: employeeRoleId, name: "Employee", isSystem: false });
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "user.role_assigned",
      actor_id: saraId,
      details: {
        before: { roleId: memberRoleId, roleName: "Member" },
        after: { roleId: employeeRoleId, roleName: "Employee" },
      },
    });
  });

  it("writes no audit entry for the same role again", async () => {
    const id = await invite();
    const before = (await auditOf(id)).length;
    expect((await assign(sara, id, memberRoleId)).status).toBe(200);
    expect((await auditOf(id)).length).toBe(before);
  });

  it("reaches the user's token at their next login", async () => {
    const { id, email: address } = await inviteActive();
    expect((await as((await login(app, address, PASSWORD)).access).get("/users")).status).toBe(200);
    await assign(sara, id, employeeRoleId);
    const fresh = await login(app, address, PASSWORD);
    expect(fresh.res.body.user.tenant).toMatchObject({
      roleId: employeeRoleId,
      roleName: "Employee",
      permissions: ["org.view"],
    });
    expect((await as(fresh.access).get("/users")).status).toBe(403);
  });

  it("refuses changing one's own role (R3.11)", async () => {
    const res = await assign(majed, majedId, memberRoleId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SELF_CHANGE_FORBIDDEN");
  });

  it("keeps the owner on Tenant Admin (R3.3)", async () => {
    const res = await assign(majed, saraId, memberRoleId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OWNER_PROTECTED");
    expect((await assign(majed, saraId, adminRoleId)).status).toBe(200);
  });

  it("refuses an unknown role, another tenant's role, and a malformed body", async () => {
    const id = await invite();
    for (const roleId of [rashidRoleId, "00000000-0000-4000-8000-000000000000"]) {
      const res = await assign(sara, id, roleId);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "roleId", code: "unknown_role" }]);
    }
    expect((await as(sara).put(`/users/${id}/role`, {})).status).toBe(400);
    expect((await assign(sara, id, "member")).status).toBe(400);
  });

  it("never reaches another tenant's users", async () => {
    for (const id of [saraId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await assign(rashid, id, rashidRoleId)).status).toBe(404);
    }
  });

  it("requires role.assign", async () => {
    const res = await assign(khalid, majedId, memberRoleId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("the subset rule for users (R3.10, P3.11)", () => {
  it("lets Huda invite with a role within her grants, but not as Tenant Admin", async () => {
    const ok = await as(huda).post("/users", {
      email: nextEmail(),
      userName: "Employee Invitee",
      roleId: employeeRoleId,
    });
    expect(ok.status).toBe(201);
    const res = await as(huda).post("/users", {
      email: nextEmail(),
      userName: "Admin Invitee",
      roleId: adminRoleId,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_NOT_HELD");
    expect(res.body.error.details).toEqual([{ path: "roleId", code: "permission_not_held" }]);
  });

  it("lets Huda move a user between roles within her grants", async () => {
    const id = await invite();
    expect((await as(huda).put(`/users/${id}/role`, { roleId: employeeRoleId })).status).toBe(200);
  });

  it("refuses giving a role beyond Huda's grants", async () => {
    const id = await invite();
    const res = await as(huda).put(`/users/${id}/role`, { roleId: adminRoleId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_NOT_HELD");
    expect(res.body.error.details).toEqual([{ path: "roleId", code: "permission_not_held" }]);
  });

  it("refuses taking a role beyond Huda's grants away from its holder", async () => {
    const res = await as(huda).put(`/users/${majedId}/role`, { roleId: employeeRoleId });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual([]);
    expect((await as(sara).get(`/users/${majedId}`)).body.user.role).toEqual(adminRole());
  });

  it("lets Huda deactivate and reactivate a user within her grants, but not a Tenant Admin", async () => {
    const { id } = await inviteActive({ roleId: employeeRoleId });
    expect((await as(huda).post(`/users/${id}/deactivate`)).status).toBe(200);
    expect((await as(huda).post(`/users/${id}/reactivate`)).status).toBe(200);

    const deactivate = await as(huda).post(`/users/${majedId}/deactivate`);
    expect(deactivate.status).toBe(403);
    expect(deactivate.body.error.code).toBe("PERMISSION_NOT_HELD");
    expect(deactivate.body.error.details).toEqual([]);

    const { id: admin } = await inviteActive({ roleId: adminRoleId });
    await as(sara).post(`/users/${admin}/deactivate`);
    expect((await as(huda).post(`/users/${admin}/reactivate`)).status).toBe(403);
    expect((await as(sara).get(`/users/${admin}`)).body.user.status).toBe("inactive");
  });

  it("checks Huda's role as it is now, not as her token says (R3.12)", async () => {
    const id = await invite();
    await pool.query(
      "delete from role_permissions where role_id = $1 and permission = 'role.assign'",
      [legalAdminRoleId],
    );
    try {
      const res = await as(huda).put(`/users/${id}/role`, { roleId: employeeRoleId });
      expect(res.status).toBe(403);
      expect(res.body.error.details).toEqual([]);
    } finally {
      await pool.query(
        "insert into role_permissions (tenant_id, role_id, permission, scope) values ($1, $2, 'role.assign', 'organization')",
        [alNoor, legalAdminRoleId],
      );
    }
  });
});

describe("deactivating and reactivating (R2.12, R2.13)", () => {
  it("deactivates a user: no login, no refresh, seat freed, manager role ended and audited", async () => {
    const unit = await unitOf("Deactivation Unit");
    const { id, email: address } = await inviteActive({ unitId: unit, isManager: true });
    const session = await login(app, address, PASSWORD);
    const usage = async () => (await as(sara).get("/subscription")).body.usage.activeUsers;
    const before = await usage();

    const res = await as(sara).post(`/users/${id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      status: "inactive",
      isManager: false,
      unit: { id: unit },
    });
    expect(await usage()).toBe(before - 1);
    expect((await login(app, address, PASSWORD)).res.status).toBe(401);
    expect(
      (await request(app).post("/auth/refresh").set("Cookie", refreshCookie(session.refresh)))
        .status,
    ).toBe(401);
    expect((await auditOf(id)).at(-1)).toMatchObject({
      action: "user.deactivated",
      details: { before: { isManager: true }, after: { isManager: false } },
    });
  });

  it("is a no-op the second time", async () => {
    const { id } = await inviteActive();
    await as(sara).post(`/users/${id}/deactivate`);
    const entries = (await auditOf(id)).length;
    expect((await as(sara).post(`/users/${id}/deactivate`)).status).toBe(200);
    expect((await auditOf(id)).length).toBe(entries);
  });

  it("refuses deactivating oneself or the owner", async () => {
    const self = await as(majed).post(`/users/${majedId}/deactivate`);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("SELF_CHANGE_FORBIDDEN");
    const owner = await as(majed).post(`/users/${saraId}/deactivate`);
    expect(owner.status).toBe(409);
    expect(owner.body.error.code).toBe("OWNER_PROTECTED");
  });

  it("makes a pending invitation link stop working", async () => {
    const address = nextEmail();
    const id = await invite({ email: address });
    const token = email.lastTokenFor(address);
    await as(sara).post(`/users/${id}/deactivate`);
    const res = await request(app).post("/auth/verify").send({ token, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VERIFICATION_INVALID");
  });

  it("reactivates a user as a plain member who can log in again", async () => {
    const unit = await unitOf("Reactivation Unit");
    const { id, email: address } = await inviteActive({ unitId: unit, isManager: true });
    await as(sara).post(`/users/${id}/deactivate`);
    const res = await as(sara).post(`/users/${id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ status: "active", isManager: false });
    expect((await login(app, address, PASSWORD)).res.status).toBe(200);
    expect((await auditOf(id)).at(-1).action).toBe("user.reactivated");
    expect((await as(sara).post(`/users/${id}/reactivate`)).status).toBe(200);
  });

  it("refuses reactivation when the tenant is full", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const small = await seedSubscribedTenant(
      pool,
      "us-full",
      [{ email: "admin@us-full.test", passwordHash }, { email: "leaver@us-full.test" }],
      2,
    );
    const admin = (await login(app, "admin@us-full.test", PASSWORD)).access;
    const leaver = small.userIds[1];
    await as(admin).post(`/users/${leaver}/deactivate`);
    expect(
      (
        await as(admin).post("/users", {
          email: "new@us-full.test",
          userName: "New",
          roleId: small.memberRoleId,
        })
      ).status,
    ).toBe(201);
    const res = await as(admin).post(`/users/${leaver}/reactivate`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_LIMIT_REACHED");
  });
});

describe("resending an invitation (R2.14)", () => {
  it("retires the older link; the new one works", async () => {
    const address = nextEmail();
    const id = await invite({ email: address });
    const first = email.lastTokenFor(address);
    expect((await as(sara).post(`/users/${id}/resend-invitation`)).status).toBe(204);
    const second = email.lastTokenFor(address);
    expect(second).not.toBe(first);
    const old = await request(app).post("/auth/verify").send({ token: first, password: PASSWORD });
    expect(old.body.error.code).toBe("VERIFICATION_INVALID");
    expect(
      (await request(app).post("/auth/verify").send({ token: second, password: NEW_PASSWORD }))
        .status,
    ).toBe(204);
    expect((await auditOf(id)).map((row) => row.action)).toContain("user.invitation_resent");
  });

  it("refuses a user who already set a password, or who is inactive", async () => {
    const verified = await as(sara).post(`/users/${khalidId}/resend-invitation`);
    expect(verified.status).toBe(409);
    expect(verified.body.error.code).toBe("ALREADY_VERIFIED");
    const id = await invite();
    await as(sara).post(`/users/${id}/deactivate`);
    const inactive = await as(sara).post(`/users/${id}/resend-invitation`);
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe("USER_INACTIVE");
  });

  it("reports a failed email as an error", async () => {
    const id = await invite();
    email.failNext();
    expect((await as(sara).post(`/users/${id}/resend-invitation`)).status).toBe(500);
  });
});

describe("Read-only tenant", () => {
  it("refuses writes and allows reads", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await seedSubscribedTenant(pool, "us-read-only", [
      { email: "admin@us-read-only.test", passwordHash },
    ]);
    await pool.query(
      "update subscriptions set start_date = start_date - 400, end_date = start_date - 100 where tenant_id = $1",
      [tenant.id],
    );
    const admin = (await login(app, "admin@us-read-only.test", PASSWORD)).access;
    const res = await as(admin).post("/users", {
      email: "x@us-read-only.test",
      userName: "X",
      roleId: tenant.memberRoleId,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    expect((await as(admin).get("/users")).status).toBe(200);
  });
});
