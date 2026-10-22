import type { WEEKDAYS } from "./calendar.config.js";

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
