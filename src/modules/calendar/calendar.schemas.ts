import { z } from "zod";
import { NO_FIELDS } from "@/http/validate.js";
import {
  MAX_DAY_VIEW_DAYS,
  MAX_PERIOD_NAME_LENGTH,
  MAX_SEASON_RANK,
  PERIOD_KINDS,
  PERIOD_RECURRENCES,
  TIME_PATTERN,
} from "./calendar.config.js";
import { daysBetweenDates } from "./shared/riyadh-time.js";

const time = z.string().regex(TIME_PATTERN);

// Zod runs refinements even after a format failure; only well-formed times are compared.
const endAfterStart = (span: { start: string; end: string }) =>
  !TIME_PATTERN.test(span.start) || !TIME_PATTERN.test(span.end) || span.end > span.start;
const END_BEFORE_START = { path: ["end"], params: { code: "end_before_start" } };

const span = z.strictObject({ start: time, end: time }).refine(endAfterStart, END_BEFORE_START);

const dayRule = z.union([z.literal("default"), z.literal("off"), span]);

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
  });

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
  });

// `kind` and `recurrence` never change: a different kind of period is a new period.
export const updatePeriodRequestSchema = z
  .strictObject(periodFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

export const periodOverrideRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("skip") }),
  z.strictObject({
    action: z.literal("move"),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  }),
]);

export const periodIdSchema = z.uuid();

export const overrideYearSchema = z.strictObject({
  year: z.coerce.number().int().min(1).max(9999),
});
