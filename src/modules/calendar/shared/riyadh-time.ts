import { CALENDAR_TIME_ZONE } from '../calendar.constants.js';

const MS_PER_DAY = 86_400_000;

const riyadhFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** An instant as a Riyadh date and the milliseconds since that date's midnight. */
export function toRiyadh(instant: Date): { date: string; ms: number } {
  const parts = riyadhFormat.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const millis = ((instant.getTime() % 1000) + 1000) % 1000;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    ms: Number(part('hour')) * 3_600_000 + Number(part('minute')) * 60_000 + Number(part('second')) * 1000 + millis,
  };
}

function utcMidnight(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * The instant at `ms` after midnight of a Riyadh date. Riyadh has no daylight saving time, so the offset found
 * at a first guess holds for the whole day. The offset is rounded to whole minutes, as every offset is, so a
 * fractional `ms` cannot leak into it.
 */
export function fromRiyadh(date: string, ms: number): Date {
  const guess = utcMidnight(date) + ms;
  const local = toRiyadh(new Date(guess));
  const offset = Math.round((utcMidnight(local.date) + local.ms - guess) / 60_000) * 60_000;
  return new Date(guess - offset);
}

/** 0 for Sunday to 6 for Saturday. */
export const weekdayIndexOf = (date: string): number => new Date(utcMidnight(date)).getUTCDay();

export const daysBetweenDates = (from: string, to: string): number => Math.round((utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY);

/** `HH:MM` (up to 24:00) as milliseconds since midnight. */
export function timeToMs(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 3_600_000 + minutes * 60_000;
}

/** Milliseconds since midnight as `HH:MM`; midnight at the end of the day is 24:00. */
export function msToTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
