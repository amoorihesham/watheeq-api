import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/pool.js";
import {
  addDays,
  effectivePrice,
  riyadhDateOf,
  subscriptionState,
} from "../src/modules/subscriptions/index.js";
import { connectToTestDb } from "./helpers/db.js";

describe("subscriptionState (R1.7)", () => {
  // Al-Noor: Basic ends 2027-10-31 with 14 grace days.
  const alNoor = { endDate: "2027-10-31", graceDays: 14 };

  it.each([
    ["2026-11-01", "active"],
    ["2027-10-31", "active"],
    ["2027-11-01", "grace"],
    ["2027-11-14", "grace"],
    ["2027-11-15", "read_only"],
    ["2028-06-01", "read_only"],
  ])("on %s is %s", (today, state) => {
    expect(subscriptionState(alNoor, today)).toBe(state);
  });

  it("goes from Active straight to Read-only with 0 grace days", () => {
    const noGrace = { endDate: "2027-10-31", graceDays: 0 };
    expect(subscriptionState(noGrace, "2027-10-31")).toBe("active");
    expect(subscriptionState(noGrace, "2027-11-01")).toBe("read_only");
  });
});

describe("addDays", () => {
  it.each([
    ["2027-10-31", 14, "2027-11-14"],
    ["2027-12-25", 14, "2028-01-08"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2027-10-31", 0, "2027-10-31"],
  ])("%s + %i days is %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe("effectivePrice (R1.2a)", () => {
  it.each([
    ["Basic 1,000 SAR with 15% then 10% off", 100_000, 15, 10, 76_500],
    ["999 halalas with 12.5% off rounds 874.125 down", 999, 12.5, 0, 874],
    ["1 halala with 50% off rounds 0.5 up", 1, 50, 0, 1],
    ["no discount", 123_456, 0, 0, 123_456],
    ["a 100% plan discount", 100_000, 100, 0, 0],
    ["a 100% customer discount", 100_000, 0, 100, 0],
    ["the maximum price with two-decimal discounts", 100_000_000, 12.34, 56.78, 37_886_652],
  ])("%s", (_label, priceHalalas, planDiscountPercent, customerDiscountPercent, expected) => {
    expect(effectivePrice({ priceHalalas, planDiscountPercent, customerDiscountPercent })).toBe(
      expected,
    );
  });

  it("stacks discounts instead of adding them, so 60% and 60% is 84% off, not 120%", () => {
    expect(
      effectivePrice({
        priceHalalas: 10_000,
        planDiscountPercent: 60,
        customerDiscountPercent: 60,
      }),
    ).toBe(1_600);
  });
});

describe("Riyadh date (R1.7)", () => {
  const pool = connectToTestDb();
  const db = createDb(pool);
  afterAll(async () => {
    await pool.end();
  });

  const riyadhDateAt = async (instant: string) => {
    const { rows } = await db.execute<{ day: string }>(
      sql`select ${riyadhDateOf(sql`${instant}::timestamptz`)} as day`,
    );
    return rows[0]?.day;
  };

  it("is still the end date at 23:59 Riyadh time (20:59 UTC), and the next day one minute later", async () => {
    expect(await riyadhDateAt("2027-10-31T20:59:00Z")).toBe("2027-10-31");
    expect(await riyadhDateAt("2027-10-31T21:00:00Z")).toBe("2027-11-01");
  });
});
