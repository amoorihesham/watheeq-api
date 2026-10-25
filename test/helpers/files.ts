import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";
import type pg from "pg";
import request from "supertest";
import type { FileStoreType } from "../../src/storage/index.js";
import { accessCookie } from "./auth.js";
import { seedUser } from "./db.js";

export const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

/** The upload request as the web app sends it: raw bytes, the name in the query string. */
export function uploadAs(
  app: express.Express,
  access: string,
  name: string,
  body: Buffer | string,
): request.Test {
  return request(app)
    .post(`/files?name=${encodeURIComponent(name)}`)
    .set("Cookie", accessCookie(access))
    .set("Content-Type", "application/octet-stream")
    .send(Buffer.from(body));
}

export interface FileRowResultType {
  id: string;
  uploaded_by: string;
  state: string;
  name: string;
  content_type: string | null;
  size_bytes: number;
  sha256: string | null;
  attached_at: Date | null;
}

export async function filesOf(pool: pg.Pool, tenantId: string): Promise<FileRowResultType[]> {
  const { rows } = await pool.query<FileRowResultType>(
    "select id, uploaded_by, state, name, content_type, size_bytes, sha256, attached_at from files where tenant_id = $1 order by created_at, id",
    [tenantId],
  );
  return rows;
}

export interface SeedFilesType {
  tenantId: string;
  userId: string;
  count: number;
  state?: "uploading" | "pending" | "attached" | "discarded";
  sizeBytes?: number;
  /** How old the rows are; defaults to new. */
  ageHours?: number;
}

/** Inserts file rows without bytes, for tests of quotas, usage, and the sweep. Returns their ids. */
export async function seedFiles(pool: pg.Pool, options: SeedFilesType): Promise<string[]> {
  const state = options.state ?? "pending";
  const { rows } = await pool.query<{ id: string }>(
    `insert into files (tenant_id, uploaded_by, state, name, content_type, sha256, size_bytes, created_at, attached_at)
     select $1, $2, $3::file_states, 'seed-' || g || '.pdf',
       case when $3 = 'uploading' then null else 'application/pdf' end,
       case when $3 = 'uploading' then null else 'seed' end,
       $4, now() - ($5::float8 * interval '1 hour'), case when $3 = 'attached' then now() end
     from generate_series(1, $6) g returning id`,
    [
      options.tenantId,
      options.userId,
      state,
      options.sizeBytes ?? 1000,
      options.ageHours ?? 0,
      options.count,
    ],
  );
  return rows.map((row) => row.id);
}

/** Adds an active member (with the plain member role) to a seeded tenant. Returns the user id. */
export async function addMember(
  pool: pg.Pool,
  tenantId: string,
  memberRoleId: string,
  email: string,
  passwordHash: string,
): Promise<string> {
  const userId = await seedUser(pool, { email, passwordHash });
  await pool.query("insert into tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
    tenantId,
    userId,
    memberRoleId,
  ]);
  return userId;
}

export interface RawResponseType {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * An HTTP request the supertest client cannot make: a chunked body, a declared length that the body does not match,
 * a connection that stops early. `body` chunks are written in order; `end` false leaves the request unfinished and
 * closes the connection's write side instead.
 */
export function rawRequest(
  app: express.Express,
  options: {
    method?: string;
    path: string;
    headers: Record<string, string>;
    chunks?: Buffer[];
    abortAfterBody?: boolean;
  },
): Promise<RawResponseType | "closed"> {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          method: options.method ?? "POST",
          path: options.path,
          headers: options.headers,
          agent: false,
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on("data", (chunk: Buffer) => parts.push(chunk));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(parts).toString(),
            });
          });
        },
      );
      req.on("error", () => {
        server.close();
        resolve("closed");
      });
      for (const chunk of options.chunks ?? []) {
        req.write(chunk);
      }
      if (options.abortAfterBody) {
        // Ends the connection without finishing the request, like a client that lost its network.
        setTimeout(() => req.destroy(), 100);
      } else {
        req.end();
      }
    });
    server.once("error", reject);
  });
}

/** A store whose `put` waits for `release()` before it reads the body; the reservation row exists meanwhile. */
export function gatedStore(inner: FileStoreType) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let enteredResolve: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve;
  });
  const store: FileStoreType = {
    ...inner,
    async put(key, body) {
      enteredResolve();
      await gate;
      await inner.put(key, body);
    },
  };
  return { store, release, entered };
}

/** A store that fails the operations named, like an unreachable object store. */
export function failingStore(
  inner: FileStoreType,
  failing: { put?: boolean; delete?: boolean; get?: boolean },
): FileStoreType {
  const down = () => Promise.reject(new Error("object store unavailable"));
  return {
    put: (key, body) => (failing.put ? down() : inner.put(key, body)),
    get: (key) => (failing.get ? down() : inner.get(key)),
    delete: (keys) => (failing.delete ? down() : inner.delete(keys)),
  };
}

/** Polls until the condition holds. */
export async function eventually(condition: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}
