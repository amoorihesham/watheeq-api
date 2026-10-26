import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import {
  type AlNoorType,
  asUser,
  type PersonType,
  seedAlNoor,
  vendorAnswers,
} from "./helpers/al-noor.js";
import { testApp } from "./helpers/app.js";
import { connectToTestDb, seedUser } from "./helpers/db.js";
import { fixture, uploadAs } from "./helpers/files.js";

// Phase 7 spec, step 7.4 (R7.11, R7.12): who is told about each lifecycle event. Al-Noor and the Vendor contract
// workflow are those of the spec's section 3.

const pool = connectToTestDb();
const app = testApp(pool, createLogger("silent"));

let alNoor: AlNoorType;
let counter = 0;
const offered: { id: string; isDefault: boolean }[] = [];
const extraNames = new Map<string, string>();

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);

const stage = (
  name: string,
  assignee: object,
  whenUnresolved: string,
  options: { escalate?: boolean } = {},
) => ({
  name,
  assignee,
  whenUnresolved,
  handlerMayNarrow: false,
  handlerMayEscalate: options.escalate ?? false,
  excludeParties: false,
});

/** Creates a workflow and adds it to the service's allowed list. */
async function offer(name: string, stages: object[]): Promise<string> {
  const created = await as("sara").post("/workflows", { name: `${name} ${++counter}`, stages });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  offered.push({ id, isDefault: false });
  const res = await as("sara").patch(`/services/${alNoor.serviceId}`, {
    workflows: [
      { id: alNoor.workflows.vendor, isDefault: true },
      { id: alNoor.workflows.complex, isDefault: false },
      ...offered,
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

/** A position in Contracts that nobody holds, so a stage that targets it resolves to nobody. */
async function emptyPosition(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into positions (tenant_id, unit_id, name) values ($1, $2, $3) returning id",
    [alNoor.tenantId, alNoor.units.contracts, `Empty desk ${++counter}`],
  );
  return rows[0]?.id ?? "";
}

async function submit(title = "Gulf Supplies contract", person: PersonType = "khalid") {
  const res = await as(person).post("/requests", {
    serviceId: alNoor.serviceId,
    priorityId: alNoor.priorities.high,
    title,
    answers: vendorAnswers(alNoor),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.data.id as string, number: res.body.data.number as string };
}

async function accept(id: string, workflowId: string, handler: PersonType = "faisal") {
  const res = await as("huda").post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids[handler],
    workflowId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

type RunType = { id: string; state: string; stage: { name: string } };
const liveRun = (request: { stages: RunType[] }) =>
  request.stages.find((run) => run.state === "active" || run.state === "held") as RunType;

async function stageAction(
  person: PersonType,
  id: string,
  action: "complete" | "return" | "refresh" | "escalate",
  body: object = {},
) {
  const current = await as(person).get(`/requests/${id}`);
  const res = await as(person).post(
    `/requests/${id}/stages/${liveRun(current.body.data).id}/${action}`,
    body,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

interface NoticeType {
  who: string;
  kind: string;
  data: Record<string, unknown>;
}

const nameOf = (userId: string) =>
  extraNames.get(userId) ??
  (Object.entries(alNoor.ids).find(([, id]) => id === userId)?.[0] as string);

async function notices(requestId: string): Promise<NoticeType[]> {
  const { rows } = await pool.query<{ user_id: string; kind: string; data: NoticeType["data"] }>(
    "select user_id, kind, data from notifications where request_id = $1 order by created_at, id",
    [requestId],
  );
  return rows.map((row) => ({ who: nameOf(row.user_id), kind: row.kind, data: row.data }));
}

/** `who:kind` for each notification, sorted, so a test names the people told and what they were told. */
const told = async (requestId: string) =>
  (await notices(requestId)).map((n) => `${n.who}:${n.kind}`).sort();

const only = (list: string[], kind: string) => list.filter((entry) => entry.endsWith(`:${kind}`));

async function addManager(unitId: string, name: string): Promise<string> {
  const id = await seedUser(pool, { email: `${name}@rn-al-noor.test` });
  await pool.query(
    "insert into tenant_members (tenant_id, user_id, role_id, unit_id, is_manager) values ($1, $2, $3, $4, true)",
    [alNoor.tenantId, id, alNoor.roles.member, unitId],
  );
  extraNames.set(id, name);
  return id;
}

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, "rn-al-noor");
});

afterAll(async () => {
  await pool.end();
});

describe("submission, withdrawal, attachments, and narrowing tell nobody (4.3)", () => {
  it("writes no notification for a submission, an attachment, or a withdrawal", async () => {
    const { id } = await submit();
    expect(await told(id)).toEqual([]);
    const upload = await uploadAs(
      app,
      alNoor.tokens.khalid,
      "contract.pdf",
      fixture("contract.pdf"),
    );
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const attached = await as("khalid").post(`/requests/${id}/files`, {
      fileIds: [upload.body.data.id],
    });
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    const withdrawn = await as("khalid").post(`/requests/${id}/withdraw`, { reason: "changed" });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(await told(id)).toEqual([]);
  });
});

describe("review (R7.12)", () => {
  it("tells Khalid of a priority change with the two names, and nobody else, not Huda", async () => {
    const { id, number } = await submit("Gulf Supplies contract");
    const res = await as("huda").put(`/requests/${id}/priority`, {
      priorityId: alNoor.priorities.urgent,
      reason: "Needed this week",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await notices(id)).toEqual([
      {
        who: "khalid",
        kind: "request.priority_changed",
        data: { number, title: "Gulf Supplies contract", before: "High", after: "Urgent" },
      },
    ]);
  });

  it("tells Khalid of a rejection, with the number and title only", async () => {
    const { id, number } = await submit("Rejected contract");
    const res = await as("huda").post(`/requests/${id}/reject`, { reason: "Out of scope" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await notices(id)).toEqual([
      { who: "khalid", kind: "request.rejected", data: { number, title: "Rejected contract" } },
    ]);
  });
});

describe("acceptance (R7.12)", () => {
  it("tells Khalid it was accepted, Faisal he is the handler, and Majed it waits on him", async () => {
    const { id, number } = await submit("Accepted contract");
    await accept(id, alNoor.workflows.vendor);
    expect(await notices(id)).toEqual(
      expect.arrayContaining([
        {
          who: "khalid",
          kind: "request.accepted",
          data: { number, title: "Accepted contract" },
        },
        {
          who: "faisal",
          kind: "request.handler_assigned",
          data: { number, title: "Accepted contract" },
        },
        {
          who: "majed",
          kind: "request.stage_assigned",
          data: { number, title: "Accepted contract", stage: "Business approval" },
        },
      ]),
    );
    expect(await told(id)).toHaveLength(3);
  });

  it("does not tell the acceptor that they are the handler", async () => {
    const { id } = await submit();
    await accept(id, alNoor.workflows.vendor, "huda");
    expect(await told(id)).toEqual(["khalid:request.accepted", "majed:request.stage_assigned"]);
  });

  it("tells Khalid both accepted and completed when every stage skips", async () => {
    const workflowId = await offer("All skip", [
      stage("Nobody one", { position: await emptyPosition() }, "skip"),
      stage("Nobody two", { position: await emptyPosition() }, "skip"),
    ]);
    const { id } = await submit();
    const accepted = await accept(id, workflowId);
    expect(accepted.state).toBe("completed");
    expect(await told(id)).toEqual([
      "faisal:request.handler_assigned",
      "khalid:request.accepted",
      "khalid:request.completed",
    ]);
  });

  it("does not tell a deactivated member", async () => {
    const { id } = await submit();
    await pool.query("update users set is_active = false where id = $1", [alNoor.ids.khalid]);
    try {
      await accept(id, alNoor.workflows.vendor);
    } finally {
      await pool.query("update users set is_active = true where id = $1", [alNoor.ids.khalid]);
    }
    expect(await told(id)).toEqual([
      "faisal:request.handler_assigned",
      "majed:request.stage_assigned",
    ]);
  });
});

describe("stages (R7.12)", () => {
  it("tells the next assignees, never the person who acted, and the requester on completion", async () => {
    const { id, number } = await submit("Stage walk");
    await accept(id, alNoor.workflows.vendor);

    await stageAction("majed", id, "complete");
    let list = await notices(id);
    expect(list.filter((n) => n.data.stage === "Drafting")).toEqual([
      {
        who: "faisal",
        kind: "request.stage_assigned",
        data: { number, title: "Stage walk", stage: "Drafting" },
      },
    ]);

    // Procurement check is skipped for nobody; sign-off climbs to Legal Affairs' managers.
    await stageAction("faisal", id, "complete");
    list = await notices(id);
    expect(
      list
        .filter((n) => n.data.stage === "Supervisor sign-off")
        .map((n) => n.who)
        .sort(),
    ).toEqual(["ahmed", "huda"]);

    // Returning starts Drafting again for Faisal, and Huda, who returned it, is not told anything.
    const beforeReturn = (await notices(id)).length;
    await stageAction("huda", id, "return", { reason: "needs a change" });
    list = (await notices(id)).slice(beforeReturn);
    expect(list.map((n) => `${n.who}:${n.kind}:${n.data.stage}`)).toEqual([
      "faisal:request.stage_assigned:Drafting",
    ]);

    await stageAction("faisal", id, "complete");
    await stageAction("huda", id, "complete");
    const all = await told(id);
    expect(only(all, "request.completed")).toEqual(["khalid:request.completed"]);
    expect(all.filter((entry) => entry.startsWith("khalid"))).toEqual([
      "khalid:request.accepted",
      "khalid:request.completed",
    ]);
  });

  it("does not tell Faisal when the next stage resolves to him again", async () => {
    const workflowId = await offer("Two drafts", [
      stage("First draft", { builtin: "handler" }, "hold"),
      stage("Second draft", { builtin: "handler" }, "hold"),
    ]);
    const { id } = await submit();
    await accept(id, workflowId);
    const before = await told(id);
    expect(before).toEqual([
      "faisal:request.handler_assigned",
      "faisal:request.stage_assigned",
      "khalid:request.accepted",
    ]);

    await stageAction("faisal", id, "complete");
    expect(await told(id)).toEqual(before);

    await stageAction("faisal", id, "complete");
    expect(await told(id)).toEqual([...before, "khalid:request.completed"].sort());
  });

  it("tells the handler when a stage is held, and only the added person when a refresh finds them", async () => {
    const position = await emptyPosition();
    const workflowId = await offer("Held then filled", [
      stage("Unfilled desk", { position }, "hold"),
    ]);
    const { id, number } = await submit();
    await accept(id, workflowId);
    expect(await notices(id)).toContainEqual({
      who: "faisal",
      kind: "request.stage_held",
      data: { number, title: "Gulf Supplies contract", stage: "Unfilled desk" },
    });
    expect(only(await told(id), "request.stage_assigned")).toEqual([]);

    await pool.query("update tenant_members set position_id = $2 where user_id = $1", [
      alNoor.ids.nora,
      position,
    ]);
    await stageAction("faisal", id, "refresh");
    expect(only(await told(id), "request.stage_assigned")).toEqual(["nora:request.stage_assigned"]);
    expect(only(await told(id), "request.stage_held")).toEqual(["faisal:request.stage_held"]);
  });

  it("tells only the people a refresh added: Majed on a held Business approval", async () => {
    const { id } = await submit();
    await pool.query("update tenant_members set is_manager = false where user_id = $1", [
      alNoor.ids.majed,
    ]);
    try {
      await accept(id, alNoor.workflows.vendor);
      expect(only(await told(id), "request.stage_held")).toEqual(["faisal:request.stage_held"]);
    } finally {
      await pool.query("update tenant_members set is_manager = true where user_id = $1", [
        alNoor.ids.majed,
      ]);
    }
    await stageAction("faisal", id, "refresh");
    expect(only(await told(id), "request.stage_assigned")).toEqual([
      "majed:request.stage_assigned",
    ]);
  });

  it("tells only the person a refresh added to a run that already has assignees", async () => {
    const { id } = await submit();
    await accept(id, alNoor.workflows.vendor);
    expect(only(await told(id), "request.stage_assigned")).toEqual([
      "majed:request.stage_assigned",
    ]);

    // Sara adds a second manager to Finance; Faisal refreshes Business approval.
    const zaid = await addManager(alNoor.units.finance, "zaid");
    await stageAction("faisal", id, "refresh");
    expect(only(await told(id), "request.stage_assigned").sort()).toEqual([
      "majed:request.stage_assigned",
      "zaid:request.stage_assigned",
    ]);
    const second = (await notices(id)).filter((n) => n.kind === "request.stage_assigned");
    expect(second.map((n) => n.who)).toEqual(["majed", "zaid"]);
    // Later tests in this file expect Business approval to wait on Majed alone.
    await pool.query("update tenant_members set is_manager = false where user_id = $1", [zaid]);
  });

  it("tells only the people a handler escalation added", async () => {
    const workflowId = await offer("Escalatable", [
      stage("Intake", { position: alNoor.positions.legalIntake }, "hold", { escalate: true }),
    ]);
    const { id } = await submit();
    await accept(id, workflowId);
    expect(only(await told(id), "request.stage_assigned")).toEqual([
      "ahmed:request.stage_assigned",
    ]);

    await stageAction("faisal", id, "escalate", { reason: "Ahmed is away" });
    expect(only(await told(id), "request.stage_assigned")).toEqual([
      "ahmed:request.stage_assigned",
      "huda:request.stage_assigned",
    ]);
  });
});

describe("handler reassignment (R7.12)", () => {
  it("tells the new handler, the previous handler, and the person the refreshed run now waits on", async () => {
    const { id } = await submit("Reassigned");
    await accept(id, alNoor.workflows.vendor);
    await stageAction("majed", id, "complete");
    const before = (await notices(id)).length;

    const res = await as("ahmed").put(`/requests/${id}/handler`, {
      handlerId: alNoor.ids.nora,
      reason: "Faisal is on leave",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = (await notices(id)).slice(before);
    expect(list.map((n) => `${n.who}:${n.kind}`).sort()).toEqual([
      "faisal:request.handler_removed",
      "nora:request.handler_assigned",
      "nora:request.stage_assigned",
    ]);
    expect(list.find((n) => n.kind === "request.stage_assigned")?.data.stage).toBe("Drafting");
  });

  it("does not tell the reassigner that they became the handler", async () => {
    const { id } = await submit();
    await accept(id, alNoor.workflows.vendor);
    const before = (await notices(id)).length;
    const res = await as("huda").put(`/requests/${id}/handler`, {
      handlerId: alNoor.ids.huda,
      reason: "I will take it",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await notices(id)).slice(before).map((n) => `${n.who}:${n.kind}`)).toEqual([
      "faisal:request.handler_removed",
    ]);
  });
});

describe("information requests and closures (R7.12)", () => {
  const base = (id: string) => `/requests/${id}/information-requests`;

  it("tells Khalid of a question and of its cancellation, and tells whoever asked of the answer", async () => {
    const { id } = await submit();
    const asked = await as("huda").post(base(id), { question: "Which entity signs?" });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const first = asked.body.data.informationRequests[0].id;
    const answered = await as("khalid").post(`${base(id)}/${first}/answer`, { answer: "Gulf Ltd" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const again = await as("huda").post(base(id), { question: "And the address?" });
    const second = again.body.data.informationRequests.find(
      (q: { state: string }) => q.state === "open",
    ).id;
    expect((await as("huda").post(`${base(id)}/${second}/cancel`)).status).toBe(200);

    expect(await told(id)).toEqual([
      "huda:request.information_answered",
      "khalid:request.information_cancelled",
      "khalid:request.information_requested",
      "khalid:request.information_requested",
    ]);
  });

  it("tells the stage assignee who asked, not the handler", async () => {
    const { id } = await submit();
    await accept(id, alNoor.workflows.vendor);
    const asked = await as("majed").post(base(id), { question: "Within the budget?" });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const infoId = asked.body.data.informationRequests[0].id;
    await as("khalid").post(`${base(id)}/${infoId}/answer`, { answer: "Yes" });
    expect(only(await told(id), "request.information_answered")).toEqual([
      "majed:request.information_answered",
    ]);
  });

  it("tells Khalid when the handler closes the request for no response", async () => {
    const { id, number } = await submit("No answer");
    await accept(id, alNoor.workflows.vendor);
    await as("faisal").post(base(id), { question: "Anything?" });
    const closed = await as("faisal").post(`/requests/${id}/close-no-response`, {
      reason: "No reply in a week",
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const list = await notices(id);
    expect(list.filter((n) => n.kind === "request.closed_no_response")).toEqual([
      { who: "khalid", kind: "request.closed_no_response", data: { number, title: "No answer" } },
    ]);
  });
});

describe("rollback (R7.11)", () => {
  it("leaves no notification when the action fails after notifying", async () => {
    const title = "rollback-me-notifications";
    const { id } = await submit(title);
    await pool.query(
      `create function rn_forced_failure() returns trigger language plpgsql as
       $$ begin raise exception 'forced failure at commit'; end $$`,
    );
    await pool.query(
      `create constraint trigger rn_forced_failure after update on requests
       deferrable initially deferred for each row
       when (new.title = 'rollback-me-notifications' and new.state = 'in_progress')
       execute function rn_forced_failure()`,
    );
    try {
      const res = await as("huda").post(`/requests/${id}/accept`, {
        handlerId: alNoor.ids.faisal,
        workflowId: alNoor.workflows.vendor,
      });
      expect(res.status).toBe(500);
    } finally {
      await pool.query("drop trigger rn_forced_failure on requests");
      await pool.query("drop function rn_forced_failure()");
    }
    const { rows } = await pool.query("select state from requests where id = $1", [id]);
    expect(rows[0].state).toBe("in_review");
    expect(await told(id)).toEqual([]);
  });
});
