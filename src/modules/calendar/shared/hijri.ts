import { addDays } from "@/modules/subscriptions/index.js";
import { HIJRI_MAX_YEAR, HIJRI_MIN_YEAR } from "../calendar.constants.js";
import type { HijriDateType } from "../calendar.types.js";

// Umm al-Qura, the Saudi civil calendar, from the runtime's ICU data (P4.6).
const hijriFormat = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** 1 Muharram 1 AH in the proleptic Gregorian calendar, and the mean month length: only for a first guess. */
const HIJRI_EPOCH = "0622-07-19";
const MEAN_MONTH_DAYS = 29.530589;

// Conversions are pure, and a server only ever asks about a few thousand dates.
const hijriCache = new Map<string, HijriDateType>();
const monthStartCache = new Map<string, string | null>();

export function toHijri(date: string): HijriDateType {
  const cached = hijriCache.get(date);
  if (cached) {
    return cached;
  }
  const parts = hijriFormat.formatToParts(new Date(`${date}T00:00:00Z`));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const hijri = { year: value("year"), month: value("month"), day: value("day") };
  hijriCache.set(date, hijri);
  return hijri;
}

/** The Gregorian date of 1 `month` `year` AH, or null outside the Umm al-Qura data. */
export function hijriMonthStart(year: number, month: number): string | null {
  if (year < HIJRI_MIN_YEAR || year > HIJRI_MAX_YEAR) {
    return null;
  }
  const key = `${year}-${month}`;
  const cached = monthStartCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let date = addDays(HIJRI_EPOCH, Math.round(((year - 1) * 12 + month - 1) * MEAN_MONTH_DAYS));
  for (let step = 0; step < 10; step++) {
    const hijri = toHijri(date);
    const monthsOff = (year - hijri.year) * 12 + (month - hijri.month);
    if (monthsOff === 0 && hijri.day === 1) {
      monthStartCache.set(key, date);
      return date;
    }
    date = addDays(date, Math.round(monthsOff * MEAN_MONTH_DAYS) - (hijri.day - 1));
  }
  throw new Error(`no Gregorian date found for 1/${month}/${year} AH`);
}

/** 29 or 30. */
export function hijriMonthLength(year: number, month: number): number | null {
  const start = hijriMonthStart(year, month);
  return start === null ? null : toHijri(addDays(start, 29)).month === month ? 30 : 29;
}

/** `day` falls on the month's last day when the month is shorter (day 30 of a 29-day month). */
export function hijriToGregorian(year: number, month: number, day: number): string | null {
  const start = hijriMonthStart(year, month);
  const length = hijriMonthLength(year, month);
  return start === null || length === null ? null : addDays(start, Math.min(day, length) - 1);
}
