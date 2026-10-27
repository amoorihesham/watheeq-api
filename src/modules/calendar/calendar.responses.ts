import { z } from "zod";
import { DAY_MODES } from "./calendar.config.js";

const dayRule = z.strictObject({
  mode: z.enum(DAY_MODES),
  start: z.string().nullable(),
  end: z.string().nullable(),
});

export const weekShapeResponseSchema = z.strictObject({
  start: z.string(),
  end: z.string(),
  days: z.strictObject({
    sun: dayRule,
    mon: dayRule,
    tue: dayRule,
    wed: dayRule,
    thu: dayRule,
    fri: dayRule,
    sat: dayRule,
  }),
});

/** An entry of `GET /calendar`'s `hours`, and what the hours writes return. */
export const hoursVersionResponseSchema = z.strictObject({
  effectiveFrom: z.string(),
  week: weekShapeResponseSchema,
});

const monthDay = z.strictObject({ month: z.number(), day: z.number() });
const dateRange = z.strictObject({ startDate: z.string(), endDate: z.string() });

/**
 * A holiday or season. Every variant carries every key (R8.4): `startDate` and `endDate` belong to a one-off
 * period, `start`, `end`, `validFrom`, `validUntil` and `overrides` to a recurring one, `week` and `rank` to a
 * season; the keys that do not apply are `null` (an empty list for `overrides`).
 */
export const periodResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["holiday", "season"]),
  recurrence: z.enum(["once", "gregorian", "hijri"]),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  start: monthDay.nullable(),
  end: monthDay.nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  overrides: z.array(
    z.strictObject({
      year: z.number(),
      action: z.enum(["skip", "move"]),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    }),
  ),
  week: weekShapeResponseSchema.nullable(),
  rank: z.number().nullable(),
  replacesId: z.string().nullable(),
  next: dateRange.nullable(),
});

export const calendarResponseSchema = z.strictObject({
  today: z.string(),
  hours: z.array(hoursVersionResponseSchema),
  periods: z.array(periodResponseSchema),
});

const idAndName = z.strictObject({ id: z.string(), name: z.string() });

export const calendarDaysResponseSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  days: z.array(
    z.strictObject({
      date: z.string(),
      hijriDate: z.strictObject({ year: z.number(), month: z.number(), day: z.number() }),
      working: z.boolean(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      holidays: z.array(idAndName),
      season: idAndName.nullable(),
    }),
  ),
});
