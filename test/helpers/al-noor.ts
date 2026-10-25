import type express from "express";
import type pg from "pg";
import request from "supertest";
import { expect } from "vitest";
import { accessCookie, hashPassword, login } from "./auth.js";
import { seedRole, seedSubscribedTenant } from "./db.js";

const PASSWORD = "correct horse battery staple";
const org = (key: string) => ({ key, scope: "organization" });

export const PEOPLE = [
  "sara",
  "huda",
  "ahmed",
  "faisal",
  "nora",
  "khalid",
  "reem",
  "majed",
  "lina",
] as const;
export type PersonType = (typeof PEOPLE)[number];

export interface AlNoorType {
  tenantId: string;
  /** User IDs by first name. */
  ids: Record<PersonType, string>;
  /** Access-cookie values by first name. */
  tokens: Record<PersonType, string>;
  units: {
    legal: string;
    contracts: string;
    litigation: string;
    finance: string;
    procurement: string;
  };
  roles: { member: string; head: string; staff: string; financeLead: string };
  positions: { contractsSupervisor: string; procurementReviewer: string; legalIntake: string };
  workflows: { vendor: string; complex: string };
  serviceId: string;
  fields: { vendorName: string; value: string; kind: string; startDate: string };
  choices: { supply: string; service: string };
  priorities: { urgent: string; high: string; normal: string };
}

/** The request client of one person: `as(token).post(path, body)`. */
export const asUser = (app: express.Express, access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  post: (path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", accessCookie(access)).send(body),
  put: (path: string, body: object) =>
    request(app).put(path).set("Cookie", accessCookie(access)).send(body),
});

/**
 * Al-Noor as in the Phase 6 spec, section 3: the org tree, the people with their roles, three positions, the workflows
 * "Vendor contract" and "Complex contract", the service "Vendor contract review" with its form, three priorities, and
 * configured escalation. `slug` makes the tenant and the email domain unique to one test file.
 */
export async function seedAlNoor(
  pool: pg.Pool,
  app: express.Express,
  slug: string,
): Promise<AlNoorType> {
  const passwordHash = await hashPassword(PASSWORD);
  const domain = `${slug}.test`;
  const tenant = await seedSubscribedTenant(
    pool,
    slug,
    PEOPLE.map((name) => ({
      email: `${name}@${domain}`,
      userName: name[0]?.toUpperCase() + name.slice(1),
      passwordHash,
    })),
  );
  const ids = Object.fromEntries(PEOPLE.map((name, i) => [name, tenant.userIds[i]])) as Record<
    PersonType,
    string
  >;

  const unit = async (name: string, parentId: string | null = null) =>
    (
      await pool.query<{ id: string }>(
        "insert into org_units (tenant_id, kind, parent_id, name) values ($1, $2, $3, $4) returning id",
        [tenant.id, parentId ? "section" : "department", parentId, name],
      )
    ).rows[0]?.id ?? "";
  const legal = await unit("Legal Affairs");
  const contracts = await unit("Contracts", legal);
  const litigation = await unit("Litigation", legal);
  const finance = await unit("Finance");
  const procurement = await unit("Procurement", finance);

  const base = [{ key: "request.submit", scope: "own" }];
  const member = await seedRole(pool, tenant.id, {
    name: "Requester",
    permissions: [...base, { key: "request.view", scope: "own" }],
  });
  const head = await seedRole(pool, tenant.id, {
    name: "Head of Legal",
    permissions: [
      ...base,
      { key: "request.view", scope: "organization" },
      org("request.review"),
      org("request.handle"),
      org("request.reassign"),
    ],
  });
  const staff = await seedRole(pool, tenant.id, {
    name: "Legal Staff",
    permissions: [...base, { key: "request.view", scope: "department" }, org("request.handle")],
  });
  const financeLead = await seedRole(pool, tenant.id, {
    name: "Finance Lead",
    permissions: [...base, { key: "request.view", scope: "department" }],
  });

  const place = (person: PersonType, roleId: string, unitId: string | null, isManager = false) =>
    pool.query(
      "update tenant_members set role_id = $2, unit_id = $3, is_manager = $4 where user_id = $1",
      [ids[person], roleId, unitId, isManager],
    );
  await place("huda", head, legal, true);
  await place("ahmed", head, legal, true);
  await place("faisal", staff, contracts, true);
  await place("nora", staff, contracts);
  await place("khalid", member, procurement);
  await place("reem", member, procurement, true);
  await place("majed", financeLead, finance, true);
  await place("lina", member, null);

  const position = async (name: string, unitId: string, holder: PersonType) => {
    const id =
      (
        await pool.query<{ id: string }>(
          "insert into positions (tenant_id, unit_id, name) values ($1, $2, $3) returning id",
          [tenant.id, unitId, name],
        )
      ).rows[0]?.id ?? "";
    await pool.query("update tenant_members set position_id = $2 where user_id = $1", [
      ids[holder],
      id,
    ]);
    return id;
  };
  const contractsSupervisor = await position("Contracts Supervisor", contracts, "faisal");
  const procurementReviewer = await position("Procurement Reviewer", procurement, "khalid");
  const legalIntake = await position("Legal Intake", legal, "ahmed");

  const tokens = {} as Record<PersonType, string>;
  for (const name of PEOPLE) {
    tokens[name] = (await login(app, `${name}@${domain}`, PASSWORD)).access;
  }
  const sara = asUser(app, tokens.sara);
  const created = async (res: request.Response, status = 201) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res;
  };

  const stage = (
    name: string,
    assignee: object,
    whenUnresolved: string,
    options: { escalate?: boolean; exclude?: boolean } = {},
  ) => ({
    name,
    assignee,
    whenUnresolved,
    handlerMayNarrow: false,
    handlerMayEscalate: options.escalate ?? false,
    excludeParties: options.exclude ?? false,
  });
  const vendorStages = [
    stage("Business approval", { builtin: "requester_department_managers" }, "hold"),
    stage("Drafting", { builtin: "handler" }, "hold"),
    stage("Procurement check", { position: procurementReviewer }, "skip", { exclude: true }),
    stage("Supervisor sign-off", { position: contractsSupervisor }, "escalate", {
      escalate: true,
      exclude: true,
    }),
  ];
  const workflowId = async (name: string, stages: object[]) =>
    (await created(await sara.post("/workflows", { name, stages }))).body.workflow.id as string;
  const vendor = await workflowId("Vendor contract", vendorStages);
  const complex = await workflowId("Complex contract", [
    ...vendorStages,
    stage("Legal Affairs approval", { builtin: "handler_department_managers" }, "hold"),
  ]);

  const service = await created(
    await sara.post("/services", {
      name: "Vendor contract review",
      workflows: [
        { id: vendor, isDefault: true },
        { id: complex, isDefault: false },
      ],
    }),
  );
  const serviceId = service.body.service.id as string;
  const form = await created(
    await sara.put(`/services/${serviceId}/form`, {
      baseRevision: 0,
      fields: [
        { type: "short_text", label: "Vendor name", required: true },
        {
          type: "number",
          label: "Contract value",
          required: true,
          min: 0,
          max: null,
          integer: false,
        },
        {
          type: "single_choice",
          label: "Contract type",
          required: true,
          options: [{ label: "Supply" }, { label: "Service" }, { label: "Lease" }],
        },
        { type: "date", label: "Start date", required: false },
      ],
    }),
    200,
  );
  const fieldsOf = form.body.service.form.fields as {
    id: string;
    label: string;
    options?: { id: string; label: string }[];
  }[];
  const field = (label: string) => fieldsOf.find((f) => f.label === label);
  const option = (label: string) =>
    field("Contract type")?.options?.find((o) => o.label === label)?.id ?? "";

  const priority = async (name: string, days: number) =>
    (await created(await sara.post("/priorities", { name, days }))).body.priority.id as string;
  const urgent = await priority("Urgent", 2);
  const high = await priority("High", 5);
  const normal = await priority("Normal", 10);

  await created(
    await sara.put("/escalation", {
      r0: { enabled: true, days: 2, recipients: [{ position: legalIntake }] },
      r1: { enabled: true, percent: 75, recipients: [{ builtin: "handler" }] },
      r2: { enabled: true, recipients: [{ builtin: "handler" }] },
    }),
    200,
  );

  return {
    tenantId: tenant.id,
    ids,
    tokens,
    units: { legal, contracts, litigation, finance, procurement },
    roles: { member, head, staff, financeLead },
    positions: { contractsSupervisor, procurementReviewer, legalIntake },
    workflows: { vendor, complex },
    serviceId,
    fields: {
      vendorName: field("Vendor name")?.id ?? "",
      value: field("Contract value")?.id ?? "",
      kind: field("Contract type")?.id ?? "",
      startDate: field("Start date")?.id ?? "",
    },
    choices: { supply: option("Supply"), service: option("Service") },
    priorities: { urgent, high, normal },
  };
}

/** Valid answers for the service of `seedAlNoor`. */
export const vendorAnswers = (alNoor: AlNoorType, vendor = "Gulf Supplies") => ({
  [alNoor.fields.vendorName]: vendor,
  [alNoor.fields.value]: 480000,
  [alNoor.fields.kind]: alNoor.choices.supply,
});
