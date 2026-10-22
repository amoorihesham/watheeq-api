import { z } from "zod";
import { TIME_PATTERN } from "./calendar.config.js";

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
