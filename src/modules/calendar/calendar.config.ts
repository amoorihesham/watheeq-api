/** Every calendar date and time is a Riyadh one (Phase 4 spec, P4.1). */
export const CALENDAR_TIME_ZONE = "Asia/Riyadh";

/** In `getUTCDay()` order, so a weekday's index is its JavaScript day number. */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** `HH:MM` from 00:00 to 24:00; strings in this form compare in time order. */
export const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** The Umm al-Qura years ICU has data for; outside them it silently falls back to an arithmetic calendar. */
export const HIJRI_MIN_YEAR = 1300;
export const HIJRI_MAX_YEAR = 1600;

/** Safety net for the next-working-day search; validation makes it unreachable (P4.12). */
export const MAX_WORKING_DAY_SEARCH_DAYS = 3660;
