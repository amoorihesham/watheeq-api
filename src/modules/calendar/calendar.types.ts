import type { z } from "zod";
import type { AuthConfigType } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { WEEKDAYS } from "./calendar.constants.js";
import type { createCalendarController } from "./calendar.controller.js";
import type { createCalendarRepository } from "./calendar.repository.js";
import type {
  calendarDaysResponseSchema,
  calendarResponseSchema,
  hoursVersionResponseSchema,
  periodResponseSchema,
  weekShapeResponseSchema,
} from "./calendar.responses.js";
import type {
  calendarQuerySchema,
  createPeriodRequestSchema,
  dayViewQuerySchema,
  periodOverrideRequestSchema,
  updatePeriodRequestSchema,
  weekShapeSchema,
} from "./calendar.schemas.js";
import type { createCalendarService } from "./calendar.service.js";

export type WeekdayType = (typeof WEEKDAYS)[number];

/** Riyadh wall-clock times, `HH:MM`, start before end. */
export interface SpanType {
  start: string;
  end: string;
}

/** `default` uses the week's own span. */
export type DayRuleType = "default" | "off" | SpanType;

/** Hours for the seven weekdays, used by normal hours and by seasons (P4.4, P4.5). */
export interface WeekShapeType extends SpanType {
  days: Record<WeekdayType, DayRuleType>;
}

export type WeekViewType = z.output<typeof weekShapeResponseSchema>;
export type HoursVersionResponseType = z.output<typeof hoursVersionResponseSchema>;

/** A version of the normal hours, in force from `effectiveFrom` until the next version (R4.3). */
export interface HoursVersionType {
  effectiveFrom: string;
  week: WeekShapeType;
}

export interface MonthDayType {
  month: number;
  day: number;
}

export interface HijriDateType {
  year: number;
  month: number;
  day: number;
}

/** An inclusive Gregorian date range. */
export interface DateRangeType {
  startDate: string;
  endDate: string;
}

/** One year's adjustment of a recurring period; `year` is in the period's own calendar (R4.7). */
export type PeriodOverrideType =
  | { year: number; action: "skip" }
  | ({ year: number; action: "move" } & DateRangeType);

type PeriodEffectType = { kind: "holiday" } | { kind: "season"; week: WeekShapeType; rank: number };

type PeriodDatesType =
  | ({ recurrence: "once" } & DateRangeType)
  | {
      recurrence: "gregorian" | "hijri";
      start: MonthDayType;
      end: MonthDayType;
      /** The version produces the occurrences whose computed start lies in this range (P4.8). */
      validFrom: string;
      validUntil: string | null;
      overrides: PeriodOverrideType[];
    };

/** A holiday or season version (P4.5). */
export type CalendarPeriodType = { id: string; name: string } & PeriodEffectType & PeriodDatesType;

export type RecurringPeriodType = Extract<
  CalendarPeriodType,
  { recurrence: "gregorian" | "hijri" }
>;

/** Everything the working-time calculation needs about one tenant. */
export interface CalendarType {
  hours: HoursVersionType[];
  periods: CalendarPeriodType[];
}

/** A working day's span in milliseconds since Riyadh midnight. */
export interface DayHoursType {
  start: number;
  end: number;
}

/** A holiday or season as the API returns it. */
export type PeriodViewType = CalendarPeriodType & {
  replacesId: string | null;
  /** The first occurrence not yet over, after adjustments, so clients need no Hijri conversion. */
  next: DateRangeType | null;
};

export type CalendarQueryType = z.output<typeof calendarQuerySchema>;
export type DayViewQueryType = z.output<typeof dayViewQuerySchema>;
export type WeekShapeInputType = z.output<typeof weekShapeSchema>;
export type CreatePeriodRequestType = z.output<typeof createPeriodRequestSchema>;
export type UpdatePeriodRequestType = z.output<typeof updatePeriodRequestSchema>;
export type PeriodOverrideRequestType = z.output<typeof periodOverrideRequestSchema>;

export type CalendarResponseType = z.output<typeof calendarResponseSchema>;
export type PeriodResponseType = z.output<typeof periodResponseSchema>;
export type CalendarDaysResponseType = z.output<typeof calendarDaysResponseSchema>;

export interface CalendarRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type CalendarRepositoryType = ReturnType<typeof createCalendarRepository>;
export type CalendarServiceType = ReturnType<typeof createCalendarService>;
export type CalendarControllerType = ReturnType<typeof createCalendarController>;
