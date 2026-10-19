import type express from "express";
import type pg from "pg";
import request from "supertest";
import { OPERATOR_COOKIE, TENANT_COOKIE } from "../../src/modules/auth/shared/cookies.js";

// Tests reach auth internals only through this file, so moving them touches one import.
export { hashPassword } from "../../src/modules/auth/shared/passwords.js";
export { OPERATOR_COOKIE, TENANT_COOKIE };

export interface Realm {
  cookie: string;
  loginPath: string;
}

export const OPERATOR_REALM: Realm = { cookie: OPERATOR_COOKIE, loginPath: "/operator/auth/login" };
export const TENANT_REALM: Realm = { cookie: TENANT_COOKIE, loginPath: "/auth/login" };

export interface LoginResult {
  status: number;
  body: {
    error: { code: string; requestId: string };
    csrfToken: string;
    user: unknown;
    operator: unknown;
  };
  token: string;
  csrf: string;
  setCookie: string;
}

/** Login and cookie helpers bound to one app and realm. */
export function realmClient(app: express.Express, realm: Realm) {
  async function login(email: string, password: string, cookie?: string): Promise<LoginResult> {
    const req = request(app).post(realm.loginPath);
    if (cookie) {
      req.set("Cookie", `${realm.cookie}=${cookie}`);
    }
    const res = await req.send({ email, password });
    const setCookie =
      ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? [])[0] ?? "";
    const token = new RegExp(`^${realm.cookie}=([^;]*)`).exec(setCookie)?.[1] ?? "";
    return { status: res.status, body: res.body, token, csrf: res.body.csrfToken, setCookie };
  }
  const authed = (token: string) => `${realm.cookie}=${token}`;
  return { login, authed };
}

/** The stored operator session behind a token, read through the superuser. */
export async function operatorSessionRow(admin: pg.Pool, token: string) {
  const { rows } = await admin.query(
    `SELECT id, encode(token_hash, 'hex') AS token_hash, last_seen_at, revoked_at, xmin::text AS xmin
       FROM operator_sessions WHERE token_hash = sha256($1::bytea)`,
    [Buffer.from(token)],
  );
  return rows[0];
}

/** The stored tenant session behind a token, read through the superuser. */
export async function userSessionRow(admin: pg.Pool, token: string) {
  const { rows } = await admin.query(
    `SELECT id, encode(token_hash, 'hex') AS token_hash, tenant_id, last_seen_at, revoked_at
       FROM user_sessions WHERE token_hash = sha256($1::bytea)`,
    [Buffer.from(token)],
  );
  return rows[0];
}
