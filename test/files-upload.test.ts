import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageKeyOf } from "../src/modules/files/index.js";
import { testApp } from "./helpers/app.js";
import { accessCookie, hashPassword, login } from "./helpers/auth.js";
import { connectToTestDb, type SeededTenant, seedSubscribedTenant } from "./helpers/db.js";
import {
  addMember,
  eventually,
  failingStore,
  filesOf,
  fixture,
  gatedStore,
  rawRequest,
  seedFiles,
  trackedStore,
  uploadAs,
} from "./helpers/files.js";
import { captureLogs } from "./helpers/log-capture.js";
import { connectToTestStore, objectExists } from "./helpers/storage.js";

// Phase 5.5 spec, R5.5.9-R5.5.16: uploading, reading, discarding, limits, types, and failures.

const PASSWORD = "correct horse battery staple";
const pool = connectToTestDb();
const store = connectToTestStore();
const capture = captureLogs();
const app = testApp(pool, capture.logger);

let alNoor: SeededTenant;
let alRashid: SeededTenant;
let khalid = "";
let faisal = "";
let majed = "";
let rashid = "";
let khalidId = "";
let passwordHash = "";
let counter = 0;

const as = (access: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", accessCookie(access)),
  delete: (path: string) => request(app).delete(path).set("Cookie", accessCookie(access)),
});

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A new active member of Al-Noor with a session, so quota tests never share a person. */
async function newMember(): Promise<{ access: string; userId: string }> {
  const email = `member${++counter}@files-alnoor.test`;
  const userId = await addMember(pool, alNoor.id, alNoor.memberRoleId, email, passwordHash);
  return { access: (await login(app, email, PASSWORD)).access, userId };
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  alNoor = await seedSubscribedTenant(pool, "files-al-noor", [
    { email: "sara@files-alnoor.test", passwordHash },
    { email: "khalid@files-alnoor.test", passwordHash },
    { email: "faisal@files-alnoor.test", passwordHash },
    { email: "majed@files-alnoor.test", passwordHash },
  ]);
  alRashid = await seedSubscribedTenant(pool, "files-al-rashid", [
    { email: "nasser@files-alrashid.test", passwordHash },
  ]);
  khalidId = alNoor.userIds[1] ?? "";
  khalid = (await login(app, "khalid@files-alnoor.test", PASSWORD)).access;
  faisal = (await login(app, "faisal@files-alnoor.test", PASSWORD)).access;
  majed = (await login(app, "majed@files-alnoor.test", PASSWORD)).access;
  rashid = (await login(app, "nasser@files-alrashid.test", PASSWORD)).access;
});

afterAll(async () => {
  await pool.end();
});

describe("upload, read, and discard (R5.5.9, R5.5.16)", () => {
  it("stores Khalid's PDF as a pending upload with its detected type, digest, and expiry", async () => {
    const bytes = fixture("contract.pdf");
    const before = Date.now();
    const res = await uploadAs(app, khalid, "draft-contract.pdf", bytes);
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toEqual({
      id: expect.any(String),
      name: "draft-contract.pdf",
      contentType: "application/pdf",
      size: bytes.length,
      sha256: sha256(bytes),
      expiresAt: expect.any(String),
    });
    const expiresAt = Date.parse(res.body.data.expiresAt);
    expect(expiresAt - before).toBeGreaterThan(24 * 3_600_000 - 5000);
    expect(expiresAt - before).toBeLessThan(24 * 3_600_000 + 10_000);

    const [row] = (await filesOf(pool, alNoor.id)).filter((f) => f.id === res.body.data.id);
    expect(row).toMatchObject({
      uploaded_by: khalidId,
      state: "pending",
      content_type: "application/pdf",
      size_bytes: bytes.length,
      sha256: sha256(bytes),
      attached_at: null,
    });
    // The bytes are under <tenant>/<file id>, and the key never holds the name.
    const key = storageKeyOf(alNoor.id, res.body.data.id);
    expect(key).toBe(`${alNoor.id}/${res.body.data.id}`);
    expect(await objectExists(store, key)).toBe(true);
    const stored: Buffer[] = [];
    for await (const chunk of await store.get(key)) {
      stored.push(chunk as Buffer);
    }
    expect(Buffer.concat(stored).equals(bytes)).toBe(true);
  });

  it("lets a member with no legal permissions upload, as Majed the stage assignee must be able to", async () => {
    const res = await uploadAs(app, majed, "signed-approval.pdf", fixture("contract.pdf"));
    expect(res.status).toBe(201);
  });

  it("lets only the uploader read, download, or discard a pending file; anyone else gets 404", async () => {
    const bytes = fixture("contract.pdf");
    const { body } = await uploadAs(app, khalid, "private.pdf", bytes);
    const id = body.data.id;

    expect((await as(khalid).get(`/files/${id}`)).body).toEqual(body);
    for (const stranger of [faisal, majed, rashid]) {
      expect((await as(stranger).get(`/files/${id}`)).status).toBe(404);
      expect((await as(stranger).get(`/files/${id}/content`)).status).toBe(404);
      expect((await as(stranger).delete(`/files/${id}`)).status).toBe(404);
    }
    expect((await as(khalid).get("/files/not-a-uuid")).status).toBe(404);
    expect((await as(khalid).get(`/files/${crypto.randomUUID()}`)).status).toBe(404);
    // The refused deletes changed nothing.
    expect((await as(khalid).get(`/files/${id}`)).status).toBe(200);
  });

  it("serves the bytes only as a download with the detected type and defensive headers (R5.5.13)", async () => {
    const bytes = fixture("contract.pdf");
    const { body } = await uploadAs(app, khalid, "Vendor contract.pdf", bytes);
    const res = await as(khalid)
      .get(`/files/${body.data.id}/content`)
      .buffer(true)
      .parse((r, done) => {
        const parts: Buffer[] = [];
        r.on("data", (c: Buffer) => parts.push(c));
        r.on("end", () => done(null, Buffer.concat(parts)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).equals(bytes)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Vendor contract.pdf"');
    expect(res.headers["content-length"]).toBe(String(bytes.length));
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("stores and returns an Arabic name as is, and downloads it with filename*=UTF-8''", async () => {
    const name = "عقد التوريد.pdf";
    const { body } = await uploadAs(app, khalid, name, fixture("contract.pdf"));
    expect(body.data.name).toBe(name);
    const res = await as(khalid).get(`/files/${body.data.id}/content`);
    expect(res.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  });

  it("discards at once: the file disappears for its uploader and the sweep deletes bytes and row later", async () => {
    const { body } = await uploadAs(app, khalid, "to-discard.pdf", fixture("contract.pdf"));
    const id = body.data.id;
    expect((await as(khalid).delete(`/files/${id}`)).status).toBe(204);
    expect((await as(khalid).get(`/files/${id}`)).status).toBe(404);
    expect((await as(khalid).get(`/files/${id}/content`)).status).toBe(404);
    expect((await as(khalid).delete(`/files/${id}`)).status).toBe(404);
    const [row] = (await filesOf(pool, alNoor.id)).filter((f) => f.id === id);
    expect(row?.state).toBe("discarded");
    expect(await objectExists(store, storageKeyOf(alNoor.id, id))).toBe(true);
  });

  it("answers an Al-Rashid user's request for an Al-Noor file ID with 404, and keys bytes under their own tenant", async () => {
    const { body } = await uploadAs(app, khalid, "noor-only.pdf", fixture("contract.pdf"));
    expect((await as(rashid).get(`/files/${body.data.id}`)).status).toBe(404);
    const theirs = await uploadAs(app, rashid, "rashid.pdf", fixture("contract.pdf"));
    expect(await objectExists(store, storageKeyOf(alRashid.id, theirs.body.data.id))).toBe(true);
    expect(await objectExists(store, storageKeyOf(alNoor.id, theirs.body.data.id))).toBe(false);
    expect((await filesOf(pool, alNoor.id)).some((f) => f.id === theirs.body.data.id)).toBe(false);
  });

  it("requires a session and a tenant user", async () => {
    expect((await request(app).get(`/files/${crypto.randomUUID()}`)).status).toBe(401);
    const res = await request(app)
      .post("/files?name=a.pdf")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("x"));
    expect(res.status).toBe(401);
  });

  it("writes no audit entry for uploads and discards (R5.5.15) and no file name into the logs", async () => {
    const { rows: before } = await pool.query(
      "select count(*)::int as n from audit_log where tenant_id = $1",
      [alNoor.id],
    );
    const secret = "secret-merger-plan.pdf";
    const { body } = await uploadAs(app, khalid, secret, fixture("contract.pdf"));
    expect((await as(khalid).get(`/files/${body.data.id}/content`)).status).toBe(200);
    await as(khalid).delete(`/files/${body.data.id}`);
    const { rows: after } = await pool.query(
      "select count(*)::int as n from audit_log where tenant_id = $1",
      [alNoor.id],
    );
    expect(after[0].n).toBe(before[0].n);
    expect(JSON.stringify(capture.lines())).not.toContain("secret-merger-plan");
  });
});

describe("names (R5.5.10)", () => {
  it("cleans path parts and control characters, and normalizes to NFC", async () => {
    const text = "plain text";
    const nested = await uploadAs(app, khalid, "../../etc/passwd.txt", text);
    expect(nested.body.data.name).toBe("passwd.txt");
    const windows = await uploadAs(app, khalid, "C:\\Users\\khalid\\notes.txt", text);
    expect(windows.body.data.name).toBe("notes.txt");
    const control = await uploadAs(app, khalid, "no\u0000tes\u0007.txt", text);
    expect(control.body.data.name).toBe("notes.txt");
    // "e" followed by a combining acute accent becomes the single composed character.
    const composed = await uploadAs(app, khalid, "cafe\u0301.txt", text);
    expect(composed.body.data.name).toBe("caf\u00e9.txt");
  });

  it.each([
    ["no name at all", "/files"],
    ["an empty name", "/files?name="],
    ["a name without an extension", "/files?name=contract"],
    ["a name that is only an extension", "/files?name=.pdf"],
    ["a name that ends in a dot", "/files?name=contract."],
    ["a name that cleans to nothing", "/files?name=..%2F"],
    ["a name given twice", "/files?name=a.pdf&name=b.pdf"],
  ])("rejects %s with invalid_name", async (_label, path) => {
    const res = await request(app)
      .post(path)
      .set("Cookie", accessCookie(khalid))
      .set("Content-Type", "application/octet-stream")
      .send(fixture("contract.pdf"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "name", code: "invalid_name" }],
    });
  });

  it("rejects a name over 255 characters", async () => {
    const res = await uploadAs(app, khalid, `${"a".repeat(252)}.pdf`, fixture("contract.pdf"));
    expect(res.status).toBe(400);
    const ok = await uploadAs(app, khalid, `${"a".repeat(251)}.pdf`, fixture("contract.pdf"));
    expect(ok.status).toBe(201);
  });

  it("refuses an extension that is not allowed, such as .exe or the legacy .doc", async () => {
    for (const name of ["setup.exe", "old.doc", "old.xls", "old.ppt", "page.html", "image.svg"]) {
      const res = await uploadAs(app, khalid, name, "content");
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });
});

describe("types, detected from the content (R5.5.10)", () => {
  it.each([
    ["contract.pdf", "contract.pdf", "application/pdf"],
    [
      "contract.docx",
      "contract.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "sheet.xlsx",
      "sheet.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [
      "deck.pptx",
      "deck.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["contract.png", "scan.png", "image/png"],
    ["contract.jpg", "photo.jpg", "image/jpeg"],
    ["contract.jpg", "photo.JPEG", "image/jpeg"],
  ])("accepts %s uploaded as %s", async (fixtureName, name, contentType) => {
    const bytes = fixture(fixtureName);
    const res = await uploadAs(app, khalid, name, bytes);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ contentType, size: bytes.length, sha256: sha256(bytes) });
  });

  it("accepts plain text, valid UTF-8 including Arabic, only as .txt, and downloads it as text/plain", async () => {
    const res = await uploadAs(app, khalid, "notes.txt", "ملاحظات العقد\nplain notes\n");
    expect(res.status).toBe(201);
    expect(res.body.data.contentType).toBe("text/plain");
    const download = await as(khalid).get(`/files/${res.body.data.id}/content`);
    expect(download.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(download.text).toBe("ملاحظات العقد\nplain notes\n");
  });

  const refused: [string, string, Buffer | string][] = [
    [
      "an executable renamed contract.pdf",
      "contract.pdf",
      Buffer.from("MZ\x90\x00\x03\x00\x00\x00"),
    ],
    ["plain text named .pdf", "contract.pdf", "just some text"],
    ["a ZIP archive named .pdf", "contract.pdf", fixture("contract.docx")],
    ["a PDF named .docx", "contract.docx", fixture("contract.pdf")],
    ["a Word file named .xlsx", "sheet.xlsx", fixture("contract.docx")],
    ["a PNG named .jpg", "photo.jpg", fixture("contract.png")],
    ["a JPEG named .png", "scan.png", fixture("contract.jpg")],
    ["a PDF named .txt", "notes.txt", fixture("contract.pdf")],
    ["text with a NUL byte named .txt", "notes.txt", Buffer.from("abc\u0000def")],
    ["text that is not UTF-8 named .txt", "notes.txt", Buffer.from([0x61, 0xff, 0xfe, 0x62])],
    ["a UTF-8 text cut inside a character", "notes.txt", Buffer.from([0x61, 0xd8])],
  ];
  it.each(refused)(
    "refuses %s with 415 and leaves no bytes or row behind",
    async (_label, name, body) => {
      const rowsBefore = (await filesOf(pool, alNoor.id)).length;
      const res = await uploadAs(app, khalid, name, body);
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
      expect((await filesOf(pool, alNoor.id)).length).toBe(rowsBefore);
    },
  );
});

describe("size and headers (R5.5.10)", () => {
  it("accepts a file of exactly 25 MB and stores every byte", async () => {
    const bytes = Buffer.alloc(25 * 1024 * 1024, "a");
    const res = await uploadAs(app, khalid, "limit.txt", bytes);
    expect(res.status).toBe(201);
    expect(res.body.data.size).toBe(26_214_400);
    expect(res.body.data.sha256).toBe(sha256(bytes));
    await as(khalid).delete(`/files/${res.body.data.id}`);
  }, 60_000);

  it("refuses a Content-Length over 25 MB with 413 before reading the body", async () => {
    const rowsBefore = (await filesOf(pool, alNoor.id)).length;
    const res = await rawRequest(app, {
      path: "/files?name=scan.pdf",
      headers: {
        Cookie: accessCookie(khalid),
        "Content-Type": "application/octet-stream",
        "Content-Length": String(26_214_401),
      },
      chunks: [Buffer.from("%PDF-1.4")],
    });
    expect(res).toMatchObject({ status: 413 });
    expect(JSON.parse((res as { body: string }).body).error.code).toBe("FILE_TOO_LARGE");
    expect((await filesOf(pool, alNoor.id)).length).toBe(rowsBefore);
  });

  it("refuses a chunked upload with 411, since the size is unknown", async () => {
    const res = await rawRequest(app, {
      path: "/files?name=scan.pdf",
      headers: {
        Cookie: accessCookie(khalid),
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      },
      chunks: [fixture("contract.pdf")],
    });
    expect(res).toMatchObject({ status: 411 });
    expect(JSON.parse((res as { body: string }).body).error.code).toBe("LENGTH_REQUIRED");
  });

  it("accepts only application/octet-stream", async () => {
    for (const type of ["application/json", "multipart/form-data; boundary=x", "text/plain"]) {
      const res = await request(app)
        .post("/files?name=a.pdf")
        .set("Cookie", accessCookie(khalid))
        .set("Content-Type", type)
        .send("x");
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  it("refuses an empty file", async () => {
    const res = await uploadAs(app, khalid, "empty.txt", "");
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "body", code: "empty_file" }]);
  });

  it("never stores more than the declared size when the client sends more", async () => {
    const declared = Buffer.alloc(100, "a");
    const tracked = trackedStore(store);
    await rawRequest(testApp(pool, capture.logger, { fileStore: tracked.store }), {
      path: "/files?name=lie.txt",
      headers: {
        Cookie: accessCookie(khalid),
        "Content-Type": "application/octet-stream",
        "Content-Length": "100",
      },
      chunks: [Buffer.concat([declared, Buffer.alloc(3000, "b")])],
    });
    // The server frames the body by Content-Length, so the extra bytes are not part of this request: either the
    // upload completes with exactly the declared bytes, or the broken connection removes it. Never in between.
    // The connection can break before the server has even reserved the row, so wait for its store work first.
    await tracked.settled();
    await eventually(
      async () =>
        (await filesOf(pool, alNoor.id)).every(
          (f) => f.name !== "lie.txt" || f.state !== "uploading",
        ),
      "the upload to settle",
    );
    const [row] = (await filesOf(pool, alNoor.id)).filter((f) => f.name === "lie.txt");
    if (row) {
      expect(row).toMatchObject({ state: "pending", size_bytes: 100, sha256: sha256(declared) });
      expect(await objectExists(store, storageKeyOf(alNoor.id, row.id))).toBe(true);
    }
  });

  it("deletes the bytes and the row when the client disconnects before sending what it declared", async () => {
    const tracked = trackedStore(store);
    const res = await rawRequest(testApp(pool, capture.logger, { fileStore: tracked.store }), {
      path: "/files?name=cut.txt",
      headers: {
        Cookie: accessCookie(khalid),
        "Content-Type": "application/octet-stream",
        "Content-Length": "1000000",
      },
      chunks: [Buffer.alloc(5000, "a")],
      abortAfterBody: true,
    });
    expect(res).toBe("closed");
    await tracked.settled();
    await eventually(
      async () => (await filesOf(pool, alNoor.id)).every((f) => f.name !== "cut.txt"),
      "the abandoned row to be removed",
    );
  });
});

describe("object store failures (R5.5.12, section 5)", () => {
  it("answers 500 INTERNAL and removes the row when the store is down", async () => {
    const down = testApp(pool, capture.logger, { fileStore: failingStore(store, { put: true }) });
    const before = (await filesOf(pool, alNoor.id)).length;
    const res = await uploadAs(down, khalid, "down.pdf", fixture("contract.pdf"));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect((await filesOf(pool, alNoor.id)).length).toBe(before);
    const logged = capture.lines().find((line) => line.msg === "upload failed");
    expect(logged).toMatchObject({ fileId: expect.any(String) });
    expect(JSON.stringify(logged)).not.toContain("down.pdf");
  });

  it("keeps the row, still marked uploading, when the bytes could not be deleted, so the sweep can retry", async () => {
    const down = testApp(pool, capture.logger, {
      fileStore: failingStore(store, { put: true, delete: true }),
    });
    const res = await uploadAs(down, khalid, "stuck.pdf", fixture("contract.pdf"));
    expect(res.status).toBe(500);
    const rows = (await filesOf(pool, alNoor.id)).filter((f) => f.name === "stuck.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("uploading");
  });
});

describe("pending-upload quota (R5.5.11)", () => {
  it("refuses the 21st pending upload and frees a place when one is discarded", async () => {
    const { access, userId } = await newMember();
    await seedFiles(pool, { tenantId: alNoor.id, userId, count: 19 });
    const twentieth = await uploadAs(app, access, "twentieth.pdf", fixture("contract.pdf"));
    expect(twentieth.status).toBe(201);
    const twentyFirst = await uploadAs(app, access, "twenty-first.pdf", fixture("contract.pdf"));
    expect(twentyFirst.status).toBe(409);
    expect(twentyFirst.body.error.code).toBe("UPLOAD_QUOTA_REACHED");

    expect((await as(access).delete(`/files/${twentieth.body.data.id}`)).status).toBe(204);
    expect((await uploadAs(app, access, "again.pdf", fixture("contract.pdf"))).status).toBe(201);
  });

  it("counts uploads in progress, and not other people's or attached files", async () => {
    const { access, userId } = await newMember();
    await seedFiles(pool, { tenantId: alNoor.id, userId, count: 20, state: "attached" });
    await seedFiles(pool, { tenantId: alNoor.id, userId: khalidId, count: 5 });
    await seedFiles(pool, { tenantId: alNoor.id, userId, count: 18, state: "uploading" });
    expect((await uploadAs(app, access, "one.pdf", fixture("contract.pdf"))).status).toBe(201);
    expect((await uploadAs(app, access, "two.pdf", fixture("contract.pdf"))).status).toBe(201);
    expect((await uploadAs(app, access, "three.pdf", fixture("contract.pdf"))).status).toBe(409);
  });

  it("lets only one of two simultaneous uploads take the last place", async () => {
    const { access, userId } = await newMember();
    await seedFiles(pool, { tenantId: alNoor.id, userId, count: 19 });
    const results = await Promise.all([
      uploadAs(app, access, "race-a.pdf", fixture("contract.pdf")),
      uploadAs(app, access, "race-b.pdf", fixture("contract.pdf")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("serializes the checks of a tenant behind the uploads lock, held only while the row is reserved", async () => {
    const { access } = await newMember();
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `uploads:${alNoor.id}`,
      ]);
      let finished = false;
      const upload = uploadAs(app, access, "waits.pdf", fixture("contract.pdf")).then((res) => {
        finished = true;
        return res;
      });
      await eventually(async () => {
        const { rows } = await pool.query(
          "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'",
        );
        return rows[0].n > 0;
      }, "the upload to wait for the lock");
      expect(finished).toBe(false);
      await holder.query("commit");
      expect((await upload).status).toBe(201);
    } finally {
      holder.release();
    }
  });

  it("does not make another tenant wait for Al-Noor's lock", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `uploads:${alNoor.id}`,
      ]);
      expect((await uploadAs(app, rashid, "free.pdf", fixture("contract.pdf"))).status).toBe(201);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });
});

describe("storage limit at upload (R5.5.18, R5.5.19)", () => {
  /** A tenant with a 1 GB limit that already holds `usedBytes`. */
  async function limitedTenant(usedBytes: number) {
    const slug = `files-limited-${++counter}`;
    const tenant = await seedSubscribedTenant(pool, slug, [
      { email: `owner@${slug}.test`, passwordHash },
      { email: `user@${slug}.test`, passwordHash },
    ]);
    await pool.query("update subscriptions set storage_limit_gb = 1 where tenant_id = $1", [
      tenant.id,
    ]);
    const userId = tenant.userIds[1] ?? "";
    const full = Math.floor(usedBytes / 26_214_400);
    await seedFiles(pool, {
      tenantId: tenant.id,
      userId: tenant.userIds[0] ?? "",
      count: full,
      sizeBytes: 26_214_400,
    });
    if (usedBytes % 26_214_400 > 0) {
      await seedFiles(pool, {
        tenantId: tenant.id,
        userId: tenant.userIds[0] ?? "",
        count: 1,
        sizeBytes: usedBytes % 26_214_400,
      });
    }
    return {
      tenant,
      userId,
      access: (await login(app, `user@${slug}.test`, PASSWORD)).access,
      slug,
    };
  }

  const GB = 1_073_741_824;

  it("refuses an upload that would pass the limit, and nothing else is affected", async () => {
    // 24 MiB left; a 25 MB file does not fit, a 1 MB file does.
    const { access, tenant } = await limitedTenant(GB - 24 * 1024 * 1024);
    const big = await uploadAs(app, access, "big.txt", Buffer.alloc(25 * 1024 * 1024, "a"));
    expect(big.status).toBe(409);
    expect(big.body.error.code).toBe("STORAGE_LIMIT_REACHED");
    expect((await filesOf(pool, tenant.id)).some((f) => f.name === "big.txt")).toBe(false);
    expect((await uploadAs(app, access, "small.txt", Buffer.alloc(1024 * 1024, "a"))).status).toBe(
      201,
    );
    // Reads, discards, and the rest of the API still work.
    const view = await as(access).get("/auth/me");
    expect(view.status).toBe(200);
  }, 60_000);

  it("accepts a file that fills the limit exactly and refuses one more byte", async () => {
    const { access } = await limitedTenant(GB - 100);
    expect((await uploadAs(app, access, "exact.txt", Buffer.alloc(100, "a"))).status).toBe(201);
    const over = await uploadAs(app, access, "over.txt", "a");
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("STORAGE_LIMIT_REACHED");
  });

  it("counts an upload in progress with its declared size, before its bytes arrive (R5.5.19)", async () => {
    const { access } = await limitedTenant(GB - 40 * 1024 * 1024);
    const gated = gatedStore(store);
    const slow = testApp(pool, capture.logger, { fileStore: gated.store });
    const first = uploadAs(slow, access, "first.txt", Buffer.alloc(25 * 1024 * 1024, "a")).then(
      (res) => res,
    );
    await gated.entered;
    // 15 MB are left once the first upload's 25 MB are reserved.
    const second = await uploadAs(app, access, "second.txt", Buffer.alloc(25 * 1024 * 1024, "a"));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("STORAGE_LIMIT_REACHED");
    gated.release();
    expect((await first).status).toBe(201);
  }, 60_000);

  it("lets one of two simultaneous 25 MB uploads succeed when 40 MB are left", async () => {
    const { access } = await limitedTenant(GB - 40 * 1024 * 1024);
    const bytes = Buffer.alloc(25 * 1024 * 1024, "a");
    const results = await Promise.all([
      uploadAs(app, access, "a.txt", bytes),
      uploadAs(app, access, "b.txt", bytes),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = results.find((r) => r.status === 409);
    expect(refused?.body.error.code).toBe("STORAGE_LIMIT_REACHED");
  }, 60_000);

  it("counts discarded files until the sweep has deleted them (R5.5.18)", async () => {
    const { access } = await limitedTenant(GB - 100);
    const first = await uploadAs(app, access, "first.txt", Buffer.alloc(100, "a"));
    expect(first.status).toBe(201);
    await as(access).delete(`/files/${first.body.data.id}`);
    expect((await uploadAs(app, access, "second.txt", "a")).status).toBe(409);
  });
});

describe("subscription states and members (R5.5.14)", () => {
  const addDays = (days: number) =>
    pool
      .query("select ((now() at time zone 'Asia/Riyadh')::date + $1::int)::text as d", [days])
      .then((r) => r.rows[0].d as string);

  async function setState(tenantId: string, state: "active" | "grace" | "read_only") {
    const endDate = await addDays({ active: 30, grace: -1, read_only: -15 }[state]);
    await pool.query(
      "update subscriptions set start_date = $2::date - 60, end_date = $2 where tenant_id = $1",
      [tenantId, endDate],
    );
  }

  it("allows uploads and discards in Grace, and refuses them in Read-only while reads keep working", async () => {
    const slug = `files-states-${++counter}`;
    const tenant = await seedSubscribedTenant(pool, slug, [
      { email: `owner@${slug}.test`, passwordHash },
    ]);
    const access = (await login(app, `owner@${slug}.test`, PASSWORD)).access;
    const { body } = await uploadAs(app, access, "kept.pdf", fixture("contract.pdf"));

    await setState(tenant.id, "grace");
    const grace = await uploadAs(app, access, "grace.pdf", fixture("contract.pdf"));
    expect(grace.status).toBe(201);
    expect((await as(access).delete(`/files/${grace.body.data.id}`)).status).toBe(204);

    await setState(tenant.id, "read_only");
    const refused = await uploadAs(app, access, "late.pdf", fixture("contract.pdf"));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    const discard = await as(access).delete(`/files/${body.data.id}`);
    expect(discard.status).toBe(403);
    expect(discard.body.error.code).toBe("SUBSCRIPTION_READ_ONLY");
    expect((await as(access).get(`/files/${body.data.id}`)).status).toBe(200);
    expect((await as(access).get(`/files/${body.data.id}/content`)).status).toBe(200);
  });

  it("refuses a deactivated member whose token is still valid", async () => {
    const { access, userId } = await newMember();
    await pool.query("update users set is_active = false where id = $1", [userId]);
    const res = await uploadAs(app, access, "late.pdf", fixture("contract.pdf"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses an operator", async () => {
    const operatorEmail = `omar@files-ops-${++counter}.test`;
    await pool.query(
      "insert into users (email, user_name, password_hash, role, email_verified_at) values ($1, 'Omar', $2, 'operator', now())",
      [operatorEmail, passwordHash],
    );
    const access = (await login(app, operatorEmail, PASSWORD)).access;
    expect((await uploadAs(app, access, "a.pdf", fixture("contract.pdf"))).status).toBe(403);
  });
});
