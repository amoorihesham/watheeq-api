import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import { createLogger } from "../src/logging/logger.js";
import { storageKeyOf, sweepFiles } from "../src/modules/files/index.js";
import { type AlNoorType, asUser, type PersonType, seedAlNoor } from "./helpers/al-noor.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import {
  createIsolatedDb,
  type IsolatedDbType,
  seedSubscribedTenant,
  waitUntilBlockedOn,
} from "./helpers/db.js";
import { filesOf, fixture, seedFiles, uploadAs } from "./helpers/files.js";
import { connectToTestStore, objectExists } from "./helpers/storage.js";

// Phase 6 spec, step 6.4: files at submission, attach, remove, download, and the 50-file cap (R6.24, R6.25).

const store = connectToTestStore();
let isolated: IsolatedDbType;
let pool: IsolatedDbType["pool"];
let app: ReturnType<typeof testApp>;
let alNoor: AlNoorType;
let rashid: string;
let fileServiceId = "";
let draftField = "";

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const codeOf = (res: { body: { error: { code: string } } }) => res.body.error.code;
const detailsOf = (res: { body: { error: { details: unknown } } }) => res.body.error.details;

async function upload(person: PersonType, name = "contract.pdf"): Promise<string> {
  const res = await uploadAs(app, alNoor.tokens[person], name, fixture("contract.pdf"));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}

const draft = (overrides: object = {}) => ({
  serviceId: fileServiceId,
  priorityId: alNoor.priorities.high,
  title: "NDA with Gulf Supplies",
  answers: {},
  ...overrides,
});

async function submit(person: PersonType = "khalid", overrides: object = {}) {
  const answers = { [draftField]: [await upload(person)] };
  const res = await as(person).post("/requests", draft({ answers, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.request as { id: string; files: { id: string }[] };
}

async function accept(id: string) {
  const res = await as("huda").post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids.faisal,
    workflowId: alNoor.workflows.vendor,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const links = (id: string) =>
  pool
    .query("select file_id, field_id, attached_by from request_files where request_id = $1", [id])
    .then((result) => result.rows);

const fileState = (fileId: string) =>
  pool
    .query("select state from files where id = $1", [fileId])
    .then((result) => result.rows[0]?.state as string | undefined);

const auditOf = (id: string) =>
  pool
    .query("select action, reason, details from audit_log where resource_id = $1 order by id", [id])
    .then((result) => result.rows);

const setSubscriptionEnd = (daysFromToday: number) =>
  pool.query(
    `update subscriptions set start_date = (now() at time zone 'Asia/Riyadh')::date - 400,
       end_date = (now() at time zone 'Asia/Riyadh')::date + $2::int where tenant_id = $1`,
    [alNoor.tenantId, daysFromToday],
  );

const download = (access: string, id: string, fileId: string) =>
  request(app)
    .get(`/requests/${id}/files/${fileId}/content`)
    .set("Cookie", accessCookie(access))
    .buffer(true)
    .parse((res, done) => {
      const parts: Buffer[] = [];
      res.on("data", (chunk: Buffer) => parts.push(chunk));
      res.on("end", () => done(null, Buffer.concat(parts)));
    });

beforeAll(async () => {
  isolated = await createIsolatedDb();
  pool = isolated.pool;
  app = testApp(pool, createLogger("silent"));
  alNoor = await seedAlNoor(pool, app, "req-files-al-noor");
  const service = await as("sara").post("/services", {
    name: "NDA review",
    workflows: [{ id: alNoor.workflows.vendor, isDefault: true }],
  });
  fileServiceId = service.body.service.id;
  const form = await as("sara").put(`/services/${fileServiceId}/form`, {
    baseRevision: 0,
    fields: [{ type: "file", label: "Draft contract", required: true, maxFiles: 3 }],
  });
  expect(form.status, JSON.stringify(form.body)).toBe(200);
  draftField = form.body.service.form.fields[0].id;

  const passwordHash = await hashPassword("correct horse battery staple");
  await seedSubscribedTenant(pool, "req-files-al-rashid", [
    { email: "admin@req-files-alrashid.test", passwordHash },
  ]);
  rashid = (await login(app, "admin@req-files-alrashid.test", "correct horse battery staple"))
    .access;
});

afterAll(async () => {
  await isolated.drop();
});

describe("files at submission (R6.3)", () => {
  it("attaches the form's files and the extra files, and lists them on the request", async () => {
    const [first, second, extra] = [
      await upload("khalid", "draft-1.pdf"),
      await upload("khalid", "draft-2.pdf"),
      await upload("khalid", "annex.pdf"),
    ];
    const res = await as("khalid").post(
      "/requests",
      draft({ answers: { [draftField]: [first, second] }, fileIds: [extra] }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = res.body.request;
    expect(created.files.map((file: { id: string }) => file.id).sort()).toEqual(
      [first, second, extra].sort(),
    );
    expect(created.files.find((file: { id: string }) => file.id === first)).toMatchObject({
      name: "draft-1.pdf",
      contentType: "application/pdf",
      fieldId: draftField,
      informationRequestId: null,
      attachedBy: { id: alNoor.ids.khalid, name: "Khalid" },
    });
    expect(created.files.find((file: { id: string }) => file.id === extra).fieldId).toBeNull();
    expect(created.answers[0].files).toEqual([
      {
        id: first,
        removed: false,
        name: "draft-1.pdf",
        contentType: "application/pdf",
        sizeBytes: expect.any(Number),
      },
      {
        id: second,
        removed: false,
        name: "draft-2.pdf",
        contentType: "application/pdf",
        sizeBytes: expect.any(Number),
      },
    ]);
    for (const id of [first, second, extra]) {
      expect(await fileState(id)).toBe("attached");
    }
    const rows = await links(created.id);
    expect(rows.filter((row) => row.field_id === draftField)).toHaveLength(2);
    const submitted = (await auditOf(created.id))[0];
    expect(submitted.action).toBe("request.submitted");
    expect(submitted.details.fileIds).toEqual([first, second, extra]);
  });

  it("refuses a file that is expired, someone else's, or named twice, and creates nothing", async () => {
    const before = await pool.query("select count(*)::int as n from requests");
    const [expired] = await seedFiles(pool, {
      tenantId: alNoor.tenantId,
      userId: alNoor.ids.khalid,
      count: 1,
      ageHours: 25,
    });
    const others = await upload("nora");
    const mine = await upload("khalid");

    const inExtra = await as("khalid").post(
      "/requests",
      draft({ answers: { [draftField]: [mine] }, fileIds: [expired, others, mine] }),
    );
    expect(inExtra.status).toBe(400);
    expect(detailsOf(inExtra)).toEqual([
      { path: "fileIds.0", code: "file_expired" },
      { path: "fileIds.1", code: "unknown_file" },
      { path: "fileIds.2", code: "file_attached" },
    ]);

    const inAnswer = await as("khalid").post(
      "/requests",
      draft({ answers: { [draftField]: [others] } }),
    );
    expect(detailsOf(inAnswer)).toEqual([
      { path: `answers.${draftField}.0`, code: "unknown_file" },
    ]);

    expect(await fileState(mine)).toBe("pending");
    const after = await pool.query("select count(*)::int as n from requests");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("refuses a 51st file and attaches nothing", async () => {
    const ids = await seedFiles(pool, {
      tenantId: alNoor.tenantId,
      userId: alNoor.ids.khalid,
      count: 51,
    });
    const res = await as("khalid").post(
      "/requests",
      draft({ answers: { [draftField]: [ids[0]] }, fileIds: ids.slice(1) }),
    );
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe("TOO_MANY_FILES");
    expect(await fileState(ids[0] ?? "")).toBe("pending");

    const fifty = await as("khalid").post(
      "/requests",
      draft({ answers: { [draftField]: [ids[0]] }, fileIds: ids.slice(1, 50) }),
    );
    expect(fifty.status, JSON.stringify(fifty.body)).toBe(201);
    expect(fifty.body.request.files).toHaveLength(50);
  });
});

describe("attaching (R6.24)", () => {
  it("lets the requester, a reviewer in review, and the handler after acceptance attach", async () => {
    const created = await submit();
    const own = await upload("khalid", "extra.pdf");
    const byRequester = await as("khalid").post(`/requests/${created.id}/files`, {
      fileIds: [own],
    });
    expect(byRequester.status, JSON.stringify(byRequester.body)).toBe(200);
    expect(byRequester.body.request.files).toHaveLength(2);
    expect(byRequester.body.request.allowedActions).toContain("attach_files");

    const byReviewer = await as("huda").post(`/requests/${created.id}/files`, {
      fileIds: [await upload("huda", "review-note.pdf")],
    });
    expect(byReviewer.status, JSON.stringify(byReviewer.body)).toBe(200);

    await accept(created.id);
    const byHandler = await as("faisal").post(`/requests/${created.id}/files`, {
      fileIds: [await upload("faisal", "draft.pdf")],
    });
    expect(byHandler.status, JSON.stringify(byHandler.body)).toBe(200);
    expect(byHandler.body.request.files).toHaveLength(4);

    const rows = await auditOf(created.id);
    expect(rows.filter((row) => row.action === "request.files_attached")).toHaveLength(3);
  });

  it("refuses a viewer who is not a party, a reviewer after acceptance, and a stranger", async () => {
    const created = await submit();
    // Majed sees Finance's requests but is no party; Huda stops being a reviewer once the request is accepted.
    const viewer = await as("majed").post(`/requests/${created.id}/files`, {
      fileIds: [await upload("majed")],
    });
    expect(viewer.status).toBe(403);
    expect(codeOf(viewer)).toBe("FORBIDDEN");
    expect(
      (await as("majed").get(`/requests/${created.id}`)).body.request.allowedActions,
    ).not.toContain("attach_files");

    await accept(created.id);
    const reviewer = await as("huda").post(`/requests/${created.id}/files`, {
      fileIds: [await upload("huda")],
    });
    expect(reviewer.status).toBe(403);

    const stranger = await asUser(app, rashid).post(`/requests/${created.id}/files`, {
      fileIds: [await upload("khalid")],
    });
    expect(stranger.status).toBe(404);
    expect(
      (await as("lina").post(`/requests/${created.id}/files`, { fileIds: [await upload("lina")] }))
        .status,
    ).toBe(404);
  });

  it("refuses a closed request, a bad body, and files that cannot be attached", async () => {
    const created = await submit();
    const pending = await upload("khalid");
    const empty = await as("khalid").post(`/requests/${created.id}/files`, { fileIds: [] });
    expect(empty.status).toBe(400);
    const extra = await as("khalid").post(`/requests/${created.id}/files`, {
      fileIds: [pending],
      note: "x",
    });
    expect(detailsOf(extra)).toEqual([{ path: "note", code: "unknown_field" }]);
    const unknown = await as("khalid").post(`/requests/${created.id}/files`, {
      fileIds: [pending, pending, "nonsense"],
    });
    expect(detailsOf(unknown)).toEqual([
      { path: "fileIds.1", code: "file_attached" },
      { path: "fileIds.2", code: "unknown_file" },
    ]);
    expect(await fileState(pending)).toBe("pending");

    await as("khalid").post(`/requests/${created.id}/withdraw`, { reason: "done" });
    const closed = await as("khalid").post(`/requests/${created.id}/files`, { fileIds: [pending] });
    expect(closed.status).toBe(409);
    expect(codeOf(closed)).toBe("INVALID_REQUEST_STATE");
  });

  it("stops at 50 files per request and attaches nothing past it", async () => {
    const created = await submit();
    const ids = await seedFiles(pool, {
      tenantId: alNoor.tenantId,
      userId: alNoor.ids.khalid,
      count: 50,
    });
    const fill = await as("khalid").post(`/requests/${created.id}/files`, {
      fileIds: ids.slice(0, 49),
    });
    expect(fill.status, JSON.stringify(fill.body)).toBe(200);
    expect(fill.body.request.files).toHaveLength(50);

    const over = await as("khalid").post(`/requests/${created.id}/files`, {
      fileIds: ids.slice(49),
    });
    expect(over.status).toBe(409);
    expect(codeOf(over)).toBe("TOO_MANY_FILES");
    expect(await fileState(ids[49] ?? "")).toBe("pending");
    expect(await links(created.id)).toHaveLength(50);
  });

  it("serializes an attach against a closing action on the request row (P6.8)", async () => {
    const created = await submit();
    const pending = await upload("khalid");
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from requests where id = $1 for update", [created.id]);
      const attaching = as("khalid")
        .post(`/requests/${created.id}/files`, { fileIds: [pending] })
        // A supertest request is only sent once something awaits it.
        .then((res) => res);
      // The attach alone must wait for the lock: it changes nothing on the request row itself.
      await waitUntilBlockedOn(pool, "requests");
      const withdrawing = as("khalid")
        .post(`/requests/${created.id}/withdraw`, { reason: "race" })
        .then((res) => res);
      const both = Promise.all([attaching, withdrawing]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await holder.query("commit");
      const [attached, withdrawn] = await both;
      expect(withdrawn.status).toBe(200);
      if (attached.status === 200) {
        expect(await fileState(pending)).toBe("attached");
      } else {
        expect(codeOf(attached)).toBe("INVALID_REQUEST_STATE");
        expect(await fileState(pending)).toBe("pending");
      }
      const state = await pool.query("select state from requests where id = $1", [created.id]);
      expect(state.rows[0].state).toBe("withdrawn");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
  });
});

describe("removing (R6.25)", () => {
  it("deletes the file for whoever attached it, shows the answer's file as removed, and keeps its fingerprint in the audit", async () => {
    const created = await submit();
    const fileId = created.files[0]?.id ?? "";
    const [row] = (await filesOf(pool, alNoor.tenantId)).filter((file) => file.id === fileId);

    const missingReason = await as("khalid").post(
      `/requests/${created.id}/files/${fileId}/remove`,
      {},
    );
    expect(detailsOf(missingReason)).toEqual([{ path: "reason", code: "invalid_type" }]);

    const removed = await as("khalid").post(`/requests/${created.id}/files/${fileId}/remove`, {
      reason: "wrong file",
    });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.request.files).toEqual([]);
    expect(removed.body.request.answers[0].files).toEqual([{ id: fileId, removed: true }]);
    expect(await links(created.id)).toEqual([]);
    expect(await fileState(fileId)).toBe("discarded");

    const entry = (await auditOf(created.id)).find((e) => e.action === "request.file_removed");
    expect(entry.reason).toBe("wrong file");
    expect(entry.details.file).toEqual({
      id: fileId,
      name: row?.name,
      sizeBytes: row?.size_bytes,
      sha256: row?.sha256,
    });

    const again = await as("khalid").post(`/requests/${created.id}/files/${fileId}/remove`, {
      reason: "again",
    });
    expect(again.status).toBe(404);

    // The sweep deletes the bytes and the row (Phase 5.5).
    await sweepFiles(createDb(pool), store);
    expect(await objectExists(store, storageKeyOf(alNoor.tenantId, fileId))).toBe(false);
    expect(await fileState(fileId)).toBeUndefined();
  });

  it("lets the handler remove another person's file, and refuses everyone else", async () => {
    const created = await submit();
    await accept(created.id);
    const attached = await as("faisal").post(`/requests/${created.id}/files`, {
      fileIds: [await upload("faisal", "mine.pdf")],
    });
    const faisalFile = attached.body.request.files.find(
      (file: { name: string }) => file.name === "mine.pdf",
    ).id;
    const khalidFile = created.files[0]?.id ?? "";

    const byViewer = await as("majed").post(`/requests/${created.id}/files/${khalidFile}/remove`, {
      reason: "no",
    });
    expect(byViewer.status).toBe(403);
    const byRequesterOfOthers = await as("khalid").post(
      `/requests/${created.id}/files/${faisalFile}/remove`,
      { reason: "no" },
    );
    expect(byRequesterOfOthers.status).toBe(403);
    const byHandler = await as("faisal").post(
      `/requests/${created.id}/files/${khalidFile}/remove`,
      { reason: "contains an ID card" },
    );
    expect(byHandler.status, JSON.stringify(byHandler.body)).toBe(200);
    expect(await fileState(khalidFile)).toBe("discarded");
  });

  it("refuses a closed request, an unknown file, and a file of another request", async () => {
    const first = await submit();
    const second = await submit();
    const foreign = await as("khalid").post(
      `/requests/${first.id}/files/${second.files[0]?.id}/remove`,
      { reason: "x" },
    );
    expect(foreign.status).toBe(404);
    const bogus = await as("khalid").post(`/requests/${first.id}/files/not-a-uuid/remove`, {
      reason: "x",
    });
    expect(bogus.status).toBe(404);

    await as("khalid").post(`/requests/${first.id}/withdraw`, { reason: "done" });
    const closed = await as("khalid").post(
      `/requests/${first.id}/files/${first.files[0]?.id}/remove`,
      { reason: "x" },
    );
    expect(closed.status).toBe(409);
    expect(codeOf(closed)).toBe("INVALID_REQUEST_STATE");
    expect(await links(first.id)).toHaveLength(1);
  });
});

describe("downloading (R6.7, R6.24)", () => {
  it("serves the bytes as a download to anyone who sees the request, and 404 to the rest", async () => {
    const created = await submit();
    const fileId = created.files[0]?.id ?? "";
    for (const person of ["khalid", "huda", "majed"] as const) {
      const res = await download(alNoor.tokens[person], created.id, fileId);
      expect(res.status, person).toBe(200);
      expect(Buffer.compare(res.body as Buffer, fixture("contract.pdf"))).toBe(0);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename=contract.pdf/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBe("sandbox");
    }
    expect((await download(alNoor.tokens.lina, created.id, fileId)).status).toBe(404);
    expect((await download(rashid, created.id, fileId)).status).toBe(404);

    const other = await submit("lina");
    expect(
      (await download(alNoor.tokens.khalid, created.id, other.files[0]?.id ?? "")).status,
    ).toBe(404);
    expect((await download(alNoor.tokens.khalid, created.id, "nonsense")).status).toBe(404);

    await as("khalid").post(`/requests/${created.id}/files/${fileId}/remove`, { reason: "gone" });
    expect((await download(alNoor.tokens.khalid, created.id, fileId)).status).toBe(404);
  });
});

describe("subscription states and isolation (R6.26, R6.27)", () => {
  it("works in Grace, and refuses every write in Read-only while downloads still work", async () => {
    const created = await submit();
    const fileId = created.files[0]?.id ?? "";
    const pending = await upload("khalid");
    await setSubscriptionEnd(-1);
    try {
      const grace = await as("khalid").post(`/requests/${created.id}/files`, {
        fileIds: [pending],
      });
      expect(grace.status, JSON.stringify(grace.body)).toBe(200);
      await setSubscriptionEnd(-30);
      const attach = await as("khalid").post(`/requests/${created.id}/files`, {
        fileIds: [
          await seedFiles(pool, {
            tenantId: alNoor.tenantId,
            userId: alNoor.ids.khalid,
            count: 1,
          }).then((ids) => ids[0]),
        ],
      });
      expect(attach.status).toBe(403);
      expect(codeOf(attach)).toBe("SUBSCRIPTION_READ_ONLY");
      const remove = await as("khalid").post(`/requests/${created.id}/files/${fileId}/remove`, {
        reason: "x",
      });
      expect(codeOf(remove)).toBe("SUBSCRIPTION_READ_ONLY");
      expect((await download(alNoor.tokens.khalid, created.id, fileId)).status).toBe(200);
    } finally {
      await setSubscriptionEnd(365);
    }
  });

  it("audits in the request's tenant and never reaches another tenant's files", async () => {
    const created = await submit();
    const fileId = created.files[0]?.id ?? "";
    const attempt = await asUser(app, rashid).post(
      `/requests/${created.id}/files/${fileId}/remove`,
      { reason: "x" },
    );
    expect(attempt.status).toBe(404);
    expect(await links(created.id)).toHaveLength(1);
    const { rows } = await pool.query(
      "select distinct tenant_id from audit_log where resource_id = $1",
      [created.id],
    );
    expect(rows).toEqual([{ tenant_id: alNoor.tenantId }]);
  });
});
