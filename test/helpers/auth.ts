import { createHash } from "node:crypto";
import type express from "express";
import request from "supertest";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../src/modules/auth/index.js";

export { hashPassword } from "../../src/modules/auth/index.js";
export { ACCESS_COOKIE, REFRESH_COOKIE };

/** The raw `Set-Cookie` lines of a response, keyed by cookie name. */
export function setCookiesOf(res: request.Response): Record<string, string> {
  const lines = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf("=")), line]));
}

/** The value a `Set-Cookie` line sets. */
export function cookieValue(line: string | undefined): string {
  return line ? decodeURIComponent(line.slice(line.indexOf("=") + 1, line.indexOf(";"))) : "";
}

export interface LoginResult {
  res: request.Response;
  access: string;
  refresh: string;
}

export async function login(
  app: express.Express,
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await request(app).post("/auth/login").send({ email, password });
  const cookies = setCookiesOf(res);
  return {
    res,
    access: cookieValue(cookies[ACCESS_COOKIE]),
    refresh: cookieValue(cookies[REFRESH_COOKIE]),
  };
}

export const accessCookie = (token: string) => `${ACCESS_COOKIE}=${token}`;
export const refreshCookie = (token: string) => `${REFRESH_COOKIE}=${token}`;

/** What `refresh_tokens.token_hash` holds for a raw token. */
export const storedHashOf = (token: string) => createHash("sha256").update(token).digest("hex");
