import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import {
  DAY_MODES,
  MAX_DAY_VIEW_DAYS,
  MAX_PERIOD_NAME_LENGTH,
  MAX_SEASON_RANK,
  PERIOD_KINDS,
  PERIOD_RECURRENCES,
  TIME_PATTERN,
} from "./calendar.constants.js";
import type { DayRuleType } from "./calendar.types.js";
import { daysBetweenDates } from "./shared/riyadh-time.js";

const time = z.string().regex(TIME_PATTERN);

// Zod runs refinements even after a format failure; only well-formed times are compared.
const endAfterStart = (span: { start: string; end: string }) =>
  !TIME_PATTERN.test(span.start) || !TIME_PATTERN.test(span.end) || span.end > span.start;
const END_BEFORE_START = { path: ["end"], params: { code: "end_before_start" } };

/**
 * A weekday as clients send and read it (Phase 8, R8.4): `start` and `end` are set for `custom` and `null`
 * otherwise. It becomes the stored rule: `"default"`, `"off"`, or the span.
 */
const dayRule = z
  .strictObject({ mode: z.enum(DAY_MODES), start: time.nullable(), end: time.nullable() })
  .superRefine((day, ctx) => {
    for (const key of ["start", "end"] as const) {
      if (day.mode === "custom" && day[key] === null) {
        ctx.addIssue({ code: "custom", path: [key], params: { code: "required" } });
      }
      if (day.mode !== "custom" && day[key] !== null) {
        ctx.addIssue({ code: "custom", path: [key], params: { code: "not_allowed" } });
      }
    }
    if (
      day.start !== null &&
      day.end !== null &&
      !endAfterStart({ start: day.start, end: day.end })
    ) {
      ctx.addIssue({ code: "custom", ...END_BEFORE_START });
    }
  })
  .transform(
    (day): DayRuleType =>
      day.mode === "custom" ? { start: day.start ?? "", end: day.end ?? "" } : day.mode,
  )
  .meta({ id: "DayRuleRequest" });

/** Normal hours and seasons share this shape (P4.4, P4.5); at least one weekday works (R4.2). */
export const weekShapeSchema = z
  .strictObject({
    start: time,
    end: time,
    days: z.strictObject({
      sun: dayRule,
      mon: dayRule,
      tue: dayRule,
      wed: dayRule,
      thu: dayRule,
      fri: dayRule,
      sat: dayRule,
    }),
  })
  .refine(endAfterStart, END_BEFORE_START)
  .refine((week) => Object.values(week.days).some((rule) => rule !== "off"), {
    path: ["days"],
    params: { code: "no_working_day" },
  })
  .meta({ id: "WeekShapeRequest" });

export const calendarDateSchema = z.iso.date();

// Query strings stay lenient: links and proxies add parameters the API does not control.
export const calendarQuerySchema = z.object({
  includeEnded: z.enum(["true", "false"]).default("false"),
});

const isDate = (value: unknown) => calendarDateSchema.safeParse(value).success;
const wellFormed = (range: { from: string; to: string }) => isDate(range.from) && isDate(range.to);

const dayViewQueryFields = z.object({ from: calendarDateSchema, to: calendarDateSchema });

export const dayViewQuerySchema = dayViewQueryFields
  .refine((range) => !wellFormed(range) || range.to >= range.from, {
    path: ["to"],
    params: { code: "end_before_start" },
  })
  .refine(
    (range) => !wellFormed(range) || daysBetweenDates(range.from, range.to) < MAX_DAY_VIEW_DAYS,
    {
      path: ["to"],
      params: { code: "range_too_long" },
    },
  );

const monthDay = z.strictObject({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

// Which fields a kind and a recurrence need is checked on the whole definition by the service, so a PATCH is
// judged on the period it produces (R4.4, R4.5).
const periodFields = {
  name: z.string().trim().min(1).max(MAX_PERIOD_NAME_LENGTH),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  start: monthDay,
  end: monthDay,
  week: weekShapeSchema,
  rank: z.number().int().min(0).max(MAX_SEASON_RANK),
};

export const createPeriodRequestSchema = z
  .strictObject(periodFields)
  .partial()
  .extend({
    kind: z.enum(PERIOD_KINDS),
    recurrence: z.enum(PERIOD_RECURRENCES),
    name: periodFields.name,
  })
  .meta({ id: "CreateCalendarPeriodRequest" });

// `kind` and `recurrence` never change: a different kind of period is a new period.
export const updatePeriodRequestSchema = z
  .strictObject(periodFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS)
  .meta({ id: "UpdateCalendarPeriodRequest" });

export const periodOverrideRequestSchema = z
  .discriminatedUnion("action", [
    z.strictObject({ action: z.literal("skip") }),
    z.strictObject({
      action: z.literal("move"),
      startDate: calendarDateSchema,
      endDate: calendarDateSchema,
    }),
  ])
  .meta({ id: "PeriodOverrideRequest" });

// A malformed date or year in a path is a 400 with a detail at its name, not the 404 of a malformed ID, so the
// declared params stay plain strings (documented through `meta`) and the service checks them with the schemas below.
export const effectiveFromParamSchema = z
  .string()
  .meta({ description: "A date, YYYY-MM-DD.", format: "date" });
export const yearParamSchema = z.string().meta({ description: "A year, 1 to 9999." });

export const overrideYearSchema = z.strictObject({
  year: z.coerce.number().int().min(1).max(9999),
});
