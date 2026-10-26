import type express from "express";
import request from "supertest";
import { accessCookie } from "./auth.js";

/**
 * Every item of a list, read page by page with the largest page size. The test database is shared by all test
 * files, so a list such as `/operator/tenants` can hold more than one page.
 */
export async function listAll<T = unknown>(
  app: express.Express,
  access: string,
  path: string,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  let total = 0;
  let cursor = "";
  for (;;) {
    const separator = path.includes("?") ? "&" : "?";
    const res = await request(app)
      .get(`${path}${separator}limit=100${cursor ? `&cursor=${cursor}` : ""}`)
      .set("Cookie", accessCookie(access));
    if (res.status !== 200) {
      throw new Error(`GET ${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
    }
    items.push(...res.body.data);
    total = res.body.page.total;
    if (!res.body.page.nextCursor) {
      return { items, total };
    }
    cursor = res.body.page.nextCursor;
  }
}
