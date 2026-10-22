# Phase 4 Spec: Working Calendar

| Field                  | Value                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**             | In Implementation                                                                                                                                                  |
| **Approved by / date** | _Amr - 22/10/2026 - 17:32 pm_                                                                                                                                      |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`), Phase 1 (`phase-1-platform-subscriptions.md`), Phase 3 (`phase-3-roles-authorization.md`) |
| **Related decisions**  | MVP 3.2, 3.6, 3.7, D4, D7, D8, D13, D21; open question 3; Technical T2, T8, T14, T15, T16, T17, T24, T25, T26                                                      |

---

## 1. Objective

Give every tenant a working calendar (working hours, seasonal hours, and holidays) and the two calculations every SLA rule needs: "add N working days to a moment" and "how many working days lie between two moments".
It is needed now because Phase 5 defines priority levels in working days (D4), Phase 6 starts the SLA clock at acceptance and writes the closure record, and Phase 7 fires R0, R1, and R2, and all of them measure time with this calendar.

## 2. Scope

**In scope:**

- One calendar per tenant, created with the tenant: normal working hours, seasonal hours, and holidays, all in `Asia/Riyadh`.
- Normal hours: a default span for every working weekday, with an optional span of its own, or a day off, for any weekday (Q4).
- Holidays and seasons ("periods"): one-off Gregorian date ranges, or ranges that recur every year on Gregorian or Hijri (Umm al-Qura) dates; one year's occurrence can be moved or skipped (Q5, Q6).
- The past is fixed: no change alters a day that has begun (Q7, Q10).
- Versioned rules: hours and recurring periods are never rewritten for days that have begun; an edit takes effect from a later date (Q8).
- The working-time calculation, with proportional placement inside a day (Q1-Q3), as a module API for Phases 6 and 7.
- Reading the calendar: its rules, and a day-by-day view of any date range up to a year.
- Permissions `calendar.view` and `calendar.manage`; audit of every change.

**Out of scope (and where it is handled instead):**

- Storing deadlines, starting the SLA clock, the closure record: Phase 6, which calls `addWorkingDays` and `workingDaysBetween`.
  Because the past is fixed, Phase 6 may compute deadlines live or store them; a stored deadline of an open request must then follow later calendar changes (Q7). Phase 6 decides.
- Firing R0-R2: Phase 7.
- Breaks inside a working day (more than one span per day): not needed by the agreed hours shape (Q4).
- A platform-provided list of Saudi public holidays: each tenant enters its own; private and public sectors, and companies, differ.
- Per-unit calendars (a branch with different hours): one calendar per tenant.
- A public "calculate a deadline" endpoint: the calculation is internal until a client needs it.

## 3. Requirements

Example tenant: **Al-Noor**, as in Phases 2 and 3.
Sara (owner) and Majed hold the Tenant Admin role, which holds `calendar.view` and `calendar.manage` the moment Phase 4 adds them (D21).
Huda (Head of Legal) is given `calendar.view`.
Today is **Thursday 2026-10-22**.

Al-Noor's calendar after Sara sets it up:

| Item                               | Definition                                                         | Example dates                                        |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| Normal hours                       | Sun-Thu 08:00-16:00, Thursday 08:00-13:00, Friday and Saturday off | every week                                           |
| Season "Ramadan hours" (Hijri)     | 1-30 Ramadan, 10:00-15:00 on every normally working day            | 1448: 2027-02-08 to 2027-03-08 (Ramadan has 29 days) |
| Holiday "Founding Day" (Gregorian) | 22 February                                                        | 2027-02-22, a Monday inside Ramadan                  |
| Holiday "Eid al-Fitr" (Hijri)      | 1-4 Shawwal                                                        | 1448: 2027-03-09 to 2027-03-12                       |
| Holiday "National Day" (Gregorian) | 23 September                                                       | 2027-09-23                                           |

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                           | Example                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R4.1  | Every tenant has a calendar from the moment it is created: Sunday to Thursday 08:00-16:00, Friday and Saturday off, no holidays, no seasons.                                                                                                                                                                                                                                          | _The operator creates Al-Rashid on 2026-11-02; its calendar has one hours version, effective 2026-11-02, with that week._                                                                                                                                                                                                                                          |
| R4.2  | Normal hours are a default span that applies to every working weekday; any weekday may instead be off or have its own span. Spans are within one day (no overnight span). At least one weekday is working.                                                                                                                                                                            | _Sara sets Thursday to 08:00-13:00. Sara marks all seven days off: 400 `no_working_day`._                                                                                                                                                                                                                                                                          |
| R4.3  | A change to normal hours is a new version with an effective date after today. On any date, the version in force is the latest one effective on or before it. A version effective after today can be replaced or deleted; one effective today or earlier cannot.                                                                                                                       | _On 2026-10-22 Sara makes Thursdays 08:00-13:00 from 2026-11-01. 2026-10-29 still uses 08:00-16:00; 2026-11-05 uses 08:00-13:00. Sara cannot change the version in force since 2026-01-10: 409 `CALENDAR_DATE_LOCKED`._                                                                                                                                            |
| R4.4  | A holiday is a named inclusive date range that is not working time. It is either one-off (Gregorian dates) or recurs every year from a start month and day to an end month and day, on the Gregorian or the Hijri (Umm al-Qura) calendar.                                                                                                                                             | _Eid al-Fitr, Hijri 1 Shawwal to 4 Shawwal, falls on 2027-03-09 to 2027-03-12 in 1448. A one-off "office move" holiday covers 2026-12-06 to 2026-12-07._                                                                                                                                                                                                           |
| R4.5  | A season is a period (same date options as a holiday) with its own week shape: a default span, and optional per-weekday spans or days off. It applies only to days that are working days under the normal hours.                                                                                                                                                                      | _Ramadan hours make 2027-02-08 to 2027-03-08 10:00-15:00. Friday stays off although the season's default span would cover it._                                                                                                                                                                                                                                     |
| R4.6  | Precedence on a date: a day off under the normal hours, or covered by any holiday, is off; otherwise the highest-ranked season covering it sets its hours; otherwise the normal hours do. Overlapping holidays simply combine. Seasons are ranked explicitly (Q9).                                                                                                                    | _2027-02-22 (Founding Day, inside Ramadan) is off. In 2015 National Day fell inside the Eid al-Adha holiday: still just days off. If Ramadan and a June-August "summer hours" season overlap (as around 2047), the higher-ranked one sets the hours._                                                                                                              |
| R4.7  | One year's occurrence of a recurring period can be moved to other Gregorian dates, or skipped. The adjustment replaces that occurrence only.                                                                                                                                                                                                                                          | _The moon sighting moves Eid al-Fitr 1448 by one day: Sara adjusts 1448 to 2027-03-10 to 2027-03-13. 1449 still follows the Umm al-Qura dates._                                                                                                                                                                                                                    |
| R4.8  | The past is fixed: no change may alter any day up to and including today (Q10). An edit of a recurring period whose occurrences have begun applies only to occurrences that start after today; occurrences that have begun keep their definition.                                                                                                                                     | _Sara adds a holiday on 2026-10-20 or 2026-10-22: 409 `CALENDAR_DATE_LOCKED`. On 2027-03-10, during Eid, Sara lengthens Eid al-Fitr to 1-5 Shawwal: Eid 1448 stays four days; from 1449 it is five. To extend this year's Eid, she adds a one-off holiday for 2027-03-13._                                                                                         |
| R4.9  | `addWorkingDays(start, n)`, for any n ≥ 0: each working day counts as one day whatever its length (Q2). The start's fraction of its working day carries over to the target day (Q3). A start outside working hours counts from the next opening. A result exactly at a day's opening is reported as the previous working day's closing. Results are rounded down to the whole minute. | _Accepted Sunday 2026-10-25 14:00 (75% through 08:00-16:00), 5 days: Sunday 2026-11-01 14:00. Accepted on the last day of Ramadan, Monday 2027-03-08 10:30 (10% through 10:00-15:00), 1 day: Eid and the weekend follow, so the next working day is Sunday 2027-03-14 (08:00-16:00), at 10%: 08:48. Accepted Sunday 07:00, 1 day: Sunday 16:00, not Monday 08:00._ |
| R4.10 | `workingDaysBetween(a, b)` measures working time from a to b in the same day units, so that `workingDaysBetween(s, addWorkingDays(s, n)) = n` (up to the minute rounding).                                                                                                                                                                                                            | _For the Sunday 2026-10-25 14:00 request (5 days): at Thursday 2026-10-29 08:00 the elapsed time is 0.25 + 3 = 3.25 days. R1 at 80% fires at `addWorkingDays(start, 4)`: Thursday 2026-10-29 14:00 (Thursdays become 08:00-13:00 only from 2026-11-01, R4.3)._                                                                                                     |
| R4.11 | The day view lists, for each date in a range of up to 366 days, its Hijri date, whether it is a working day, its hours, and the holidays and season that apply.                                                                                                                                                                                                                       | _Huda opens 2027-02-20 to 2027-03-14 and sees Ramadan hours, Founding Day off, the Eid days off, and normal hours from 2027-03-14._                                                                                                                                                                                                                                |
| R4.12 | `calendar.view` is needed to read the calendar, `calendar.manage` to change it; both have organization scope only.                                                                                                                                                                                                                                                                    | _Huda (view only) reads the day view; her `POST /calendar/periods` returns 403 `FORBIDDEN`._                                                                                                                                                                                                                                                                       |
| R4.13 | Every change is audited in the same transaction with what changed, and refused while the subscription is Read-only.                                                                                                                                                                                                                                                                   | _Sara adds Eid al-Fitr: `calendar.period_created` with its definition. In Read-only: 403 `SUBSCRIPTION_READ_ONLY`; reading still works._                                                                                                                                                                                                                           |
| R4.14 | Calendar endpoints only read or change the caller's tenant's calendar.                                                                                                                                                                                                                                                                                                                | _Sara sends an Al-Rashid period ID to `PATCH /calendar/periods/:periodId`: 404._                                                                                                                                                                                                                                                                                   |

## 4. Design

### 4.1 Data model

#### What a calendar is made of

On any Riyadh date, the calendar answers one question: is this a working day, and if so, from when to when.
Three kinds of rules produce the answer:

```
normal hours (versioned by effective date)   -> the week: which weekdays work, and their spans
seasons (periods of kind "season")           -> replace the span on working days they cover
holidays (periods of kind "holiday")         -> turn days off
```

Holidays and seasons share everything except their effect: a name, one-off or recurring dates, Gregorian or Hijri recurrence, one-year adjustments, and the past-is-fixed rule.
They are one table, `calendar_periods`, with a `kind`, so recurrence, adjustment, and versioning are written and tested once.

A **week shape** describes hours for the seven weekdays, used by normal hours and by seasons:

```json
{
  "start": "08:00",
  "end": "16:00",
  "days": {
    "sun": "default",
    "mon": "default",
    "tue": "default",
    "wed": "default",
    "thu": { "start": "08:00", "end": "13:00" },
    "fri": "off",
    "sat": "off"
  }
}
```

It is stored as `jsonb` and validated by zod.
Why not a child table with one row per weekday: the calendar is always read whole into memory and never queried by weekday in SQL (unlike Phase 3's grants, which Phase 7 queries by permission), and the same shape is used by two tables.

**`working_hours`** (new, tenant data): one row per version of the normal hours.

| Column                     | Type          | Notes                                                                      |
| -------------------------- | ------------- | -------------------------------------------------------------------------- |
| `tenant_id`                | `uuid`        | FK to `tenants`, not null.                                                 |
| `effective_from`           | `date`        | The first Riyadh date this version applies to.                             |
| `week`                     | `jsonb`       | A week shape; check `jsonb_typeof(week) = 'object'` as a second safeguard. |
| `created_at`, `updated_at` | `timestamptz` |                                                                            |

Primary key `(tenant_id, effective_from)`: one version per date, so `PUT /calendar/hours/:effectiveFrom` is a natural upsert.
The first version's `effective_from` is the tenant's creation date in Riyadh, and the calculation never looks earlier than that (4.3).

**`calendar_periods`** (new, tenant data): one row per version of a holiday or season.

| Column                                             | Type                         | Notes                                                                                                               |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                                               | `uuid` PK                    |                                                                                                                     |
| `tenant_id`                                        | `uuid`                       | FK to `tenants`, not null.                                                                                          |
| `kind`                                             | `calendar_period_kinds` enum | `holiday`, `season`.                                                                                                |
| `name`                                             | `text`                       | Trimmed, 1-100 characters (check).                                                                                  |
| `recurrence`                                       | `calendar_recurrences` enum  | `once`, `gregorian`, `hijri`.                                                                                       |
| `start_date`, `end_date`                           | `date`                       | `once` only: the inclusive Gregorian range.                                                                         |
| `start_month`, `start_day`, `end_month`, `end_day` | `smallint`                   | Recurring only: month 1-12, day 1-31 (Gregorian) or 1-30 (Hijri). An end before the start wraps into the next year. |
| `week`                                             | `jsonb`                      | Seasons only: a week shape.                                                                                         |
| `rank`                                             | `smallint`                   | Seasons only: higher wins when seasons overlap (Q9).                                                                |
| `valid_from`                                       | `date`                       | Recurring only: the version produces occurrences that start on or after this date.                                  |
| `valid_until`                                      | `date`                       | Recurring only, nullable: ...and on or before this date. Set when the version is ended by an edit or a delete.      |
| `replaces_id`                                      | `uuid`                       | Nullable: the version this one replaced, for history and audit.                                                     |
| `created_at`, `updated_at`                         | `timestamptz`                |                                                                                                                     |

Checks: exactly the columns of the row's `recurrence` are set; `week` and `rank` are set if and only if `kind = 'season'`; `start_date <= end_date`; `valid_from <= valid_until`.
Unique `(tenant_id, id)` is the target of the composite foreign key below (T21).

**`calendar_period_overrides`** (new, tenant data): one-year adjustments of recurring periods.

| Column                   | Type                             | Notes                                                                                            |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tenant_id`              | `uuid`                           | Not null.                                                                                        |
| `period_id`              | `uuid`                           | Composite FK `(tenant_id, period_id)` → `calendar_periods (tenant_id, id)`, `on delete cascade`. |
| `year`                   | `integer`                        | The occurrence's year in the period's own calendar (Gregorian year, or Hijri year).              |
| `action`                 | `calendar_override_actions` enum | `move`, `skip`.                                                                                  |
| `start_date`, `end_date` | `date`                           | `move` only: the occurrence's new Gregorian range.                                               |

Primary key `(period_id, year)`: at most one adjustment per occurrence.

#### Versioning: how an edit leaves the past alone

Example: Eid al-Fitr was created in 2026 as 1-4 Shawwal (row A, `valid_from` 2026-10-23, `valid_until` null).
On 2028-01-15 Sara changes it to 1-5 Shawwal.
Row A's occurrences in 1448 (2027) have begun, so A cannot change.
The edit, in one transaction:

1. Sets A's `valid_until` to today, 2028-01-15: A keeps producing every occurrence that started on or before today.
2. Inserts row B, a copy of A with the new days, `valid_from` 2028-01-16, `replaces_id` A.
3. Moves A's adjustments of occurrences that start after today to B.

The client gets B back, with a new ID.
When no occurrence of a version has started yet (`valid_from` after today), an edit simply updates the row.
A delete works the same way: a version with started occurrences is ended (`valid_until` = today); one without is removed with its adjustments.
A one-off period cannot be edited or deleted once its start date is today or earlier.

Why versions instead of editing rows and keeping an audit trail: the calculation must reproduce the calendar as it was on any past date, for example when Phase 6 writes a closure record for a request accepted a year earlier.
With versions, the rules that applied to a past date are still rows in the table; with in-place edits, they exist only in audit details.

#### Migration

Migration `0006` creates the three tables and enums, and inserts the default normal hours for every existing tenant, effective on its creation date in Riyadh.

#### Audit actions

| Action                      | Resource        | `details`                                                                     |
| --------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `calendar.hours_set`        | working hours   | `{effectiveFrom, before, after}` (`before` null for a new version)            |
| `calendar.hours_deleted`    | working hours   | `{effectiveFrom, week}`                                                       |
| `calendar.period_created`   | calendar period | The period's definition.                                                      |
| `calendar.period_updated`   | calendar period | `{before, after, replacedId}`; `replacedId` set when the edit ended a version |
| `calendar.period_deleted`   | calendar period | `{definition, ended}`; `ended` true when the version was ended, not removed   |
| `calendar.override_set`     | calendar period | `{year, before, after}`                                                       |
| `calendar.override_deleted` | calendar period | `{year, override}`                                                            |

Tenant creation (Phase 1) writes `calendar.hours_set` for the default version.

### 4.2 API

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
In Read-only, every write below is refused by the guard.
All dates are Riyadh dates (`YYYY-MM-DD`); all times are Riyadh wall-clock times (`HH:MM`).

| Method | Path                                          | Permission        | Request                                                     | Responses                                                                                                         |
| ------ | --------------------------------------------- | ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/calendar`                                   | `calendar.view`   | `includeEnded?` (default false)                             | 200 `{today, hours:[version], periods:[period]}`                                                                  |
| GET    | `/calendar/days`                              | `calendar.view`   | `from`, `to` (at most 366 days)                             | 200 `{days:[day]}`; 400                                                                                           |
| PUT    | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | a week shape                                                | 200 `{version}`; 400; 409 `CALENDAR_DATE_LOCKED`                                                                  |
| DELETE | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`                                                                              |
| POST   | `/calendar/periods`                           | `calendar.manage` | a period definition                                         | 201 `{period}`; 400; 409 `CALENDAR_DATE_LOCKED`                                                                   |
| PATCH  | `/calendar/periods/:periodId`                 | `calendar.manage` | any fields of the definition except `kind` and `recurrence` | 200 `{period}` (a new ID when a version was ended); 400; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED` |
| DELETE | `/calendar/periods/:periodId`                 | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED`                                                     |
| PUT    | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | `{action:"move", startDate, endDate}` or `{action:"skip"}`  | 200 `{period}`; 400; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED`                                     |
| DELETE | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`                                                                              |

A **period definition**: `{kind, name, recurrence, startDate?, endDate?, start?: {month, day}, end?: {month, day}, week?, rank?}`.
A **period** in a response adds `id`, `validFrom`, `validUntil`, `replacesId`, `overrides:[{year, action, startDate?, endDate?}]`, and `next`: the next occurrence's Gregorian range (after adjustments), so a client shows "Eid al-Fitr: 2027-03-09 to 2027-03-12" without converting Hijri dates itself.
A recurring period is created with `validFrom` = tomorrow.
`kind` and `recurrence` cannot change; a different kind of period is a new period.
A **day**: `{date, hijriDate: {year, month, day}, working, start?, end?, holidays:[{id, name}], season?: {id, name}}`.

`GET /calendar` lists every hours version (they are few) and, unless `includeEnded`, only periods whose versions are still in force or in the future.

#### Validation

- Times: `HH:MM`, 00:00 to 24:00; `start < end`.
- Week shape: every weekday present; at least one working weekday (`no_working_day`).
- Dates and `:effectiveFrom`: valid Riyadh dates, at most 5 years after today (`too_far_ahead`).
- One-off range and moved occurrence: `startDate <= endDate` (`end_before_start`); a holiday at most 30 days, a season at most 184 days (`period_too_long`), also checked on recurring rules' longest possible occurrence.
- Recurring days: a valid month and day; Gregorian 29 February is allowed and falls on 28 February in other years; Hijri day 30 falls on the 29th in a 29-day month.
- Overrides: only on recurring periods (`not_recurring`); `year` within the Umm al-Qura data range for Hijri periods (1300-1600 AH).
- `rank`: an integer 0-100, unique among the tenant's seasons in force (`rank_taken`).

#### New error codes

| HTTP | Code                    | When                                                                                   |
| ---- | ----------------------- | -------------------------------------------------------------------------------------- |
| 409  | `CALENDAR_DATE_LOCKED`  | The change would alter a day up to and including today (R4.3, R4.8).                   |
| 409  | `CALENDAR_PERIOD_ENDED` | The period version was already ended by an earlier edit or delete; the client reloads. |

### 4.3 Key flows

#### The working-time calculation

`loadCalendar(db, tenantId)` reads the tenant's hours versions, periods (all versions), and overrides into a `CalendarType`.
Everything else is pure functions over it, in `calendar/shared/`, with no database access:

```ts
dayHours(calendar, date): { start: Minutes; end: Minutes } | null   // null: not a working day
addWorkingDays(calendar, start: Date, days: number): Date
workingDaysBetween(calendar, from: Date, to: Date): number
```

`dayHours(date)`:

1. The hours version in force on `date`; its span for the weekday, or null if off.
2. Null if any holiday occurrence covers `date`.
3. The highest-ranked season occurrence covering `date`, if any: its span for the weekday, or null if off.
4. Otherwise the span from step 1.

An occurrence of a recurring period comes from the version whose validity contains the occurrence's computed start date; an override for that year replaces or removes it.
Hijri dates are converted with the runtime's `Intl` Umm al-Qura calendar (`islamic-umalqura`), so no dependency is added.

**Proportional position.**
A moment `t` on a working day with span `[s, e]` has the fraction `f = (t - s) / (e - s)`, clamped to `[0, 1]`.
A moment on a day off, or after closing, is at fraction 0 of the next working day.
`addWorkingDays(t, n)` moves from working day `d0` at fraction `f` to `d0 + floor(f + n)` working days at fraction `frac(f + n)`.
`workingDaysBetween(a, b)` is the number of whole working days between their positions plus the difference of their fractions.

Worked example (R4.9): accepted Monday 2027-03-08 10:30, the last day of Ramadan (10:00-15:00), so `f = 0.5h / 5h = 0.1`; `n = 1`.
Eid (Tuesday to Friday) and Saturday are off, so the target is Sunday 2027-03-14 (08:00-16:00) at `0.1`: 08:00 + 0.1 × 8h = **08:48**.
Legal gets 90% of the Monday and 10% of the Sunday: exactly one day.

**Boundary.**
Fraction 0 of a working day and fraction 1 of the previous one are the same point in working time.
A result at fraction 0 is reported as the previous working day's closing time: "Sunday 16:00", not "Monday 08:00".

**Termination.**
The search for the next working day stops after 3,660 days (ten years) and throws `CalendarExhaustedError`, a 500 with a log entry.
Validation already makes this unreachable (a working weekday always exists, holidays are at most 30 days); the bound keeps a defect from becoming an endless loop.

**Time zone.**
`Asia/Riyadh` observes no daylight saving time, so each Riyadh date is one 24-hour interval at UTC+3.
The conversion still goes through the time zone name (`Intl`), not a hard-coded offset.

#### Changing the calendar

Every write runs in one transaction:

1. Take the tenant's calendar lock: `pg_advisory_xact_lock(hashtextextended('calendar:' || tenant_id, 0))`.
2. Read today in Riyadh from the database (`riyadhToday`, T15).
3. Validate, including the past-is-fixed rule: the change may only affect dates after today (Q10).
4. Write, as in 4.1 ("Versioning").
5. Audit.

Why the lock: Sara and Majed both edit Eid al-Fitr at the same moment, and both see version A with started occurrences.
Without the lock, both end A and both insert a new version from tomorrow: Eid exists twice, and for a season two overlapping versions would compete for the same days.
With the lock, Majed's transaction waits for Sara's commit, then finds A ended and gets 409 `CALENDAR_PERIOD_ENDED`.
The lock also covers rank uniqueness among seasons and the "a version effective today or earlier cannot change" check against a concurrent PUT.

#### Create a tenant (changed)

In Phase 1's transaction, after the tenant row: insert the default normal hours effective today and audit `calendar.hours_set`.

### 4.4 Module structure

```
src/
  db/schema/calendar.ts                     new: working_hours, calendar_periods, calendar_period_overrides, enums
  http/errors.ts                            (changed) new codes
  modules/
    calendar/                               new
      calendar.routes.ts (composes), .controller.ts, .service.ts, .repository.ts
      calendar.config.ts, .schemas.ts, .types.ts
      shared/week.ts                        week shape and dayHours
      shared/hijri.ts                       Gregorian <-> Umm al-Qura conversion
      shared/occurrences.ts                 expanding periods, versions, and overrides
      shared/working-time.ts                addWorkingDays, workingDaysBetween
      index.ts                              loadCalendar and the working-time functions for Phases 6 and 7
    tenant-access/                          (changed) calendar.view, calendar.manage in the catalog
    platform/tenants/                       (changed) default hours with the tenant
    subscriptions/                          riyadhDateOf / riyadhToday reused (moved to db/ if a second module needs them)
```

`app.ts` gains `/calendar`.

## 5. Edge Cases and Failure Behavior

| Scenario                                                                                             | Expected behavior                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sara and Majed edit the same recurring period at the same moment.                                    | The calendar lock serializes them; the second gets 409 `CALENDAR_PERIOD_ENDED` if the first ended the version, or edits the row the first left.          |
| Sara puts a new hours version for 2026-11-01 while Majed deletes it.                                 | Serialized by the lock; the result is the order they ran in.                                                                                             |
| Sara deletes the hours version in force today.                                                       | 409 `CALENDAR_DATE_LOCKED`. The first version can never be deleted, because it is in force from the tenant's creation.                                   |
| A one-off holiday that started yesterday.                                                            | Cannot be edited or deleted (409). An extra day is a new one-off holiday after today.                                                                    |
| Sara skips Founding Day for 2027, then the 2027 occurrence starts.                                   | The skip is locked from 2027-02-22 on.                                                                                                                   |
| Eid al-Fitr, an adjustment for 1448 exists, and Sara edits the rule on 2027-01-10 (before Eid 1448). | The version has started occurrences (1447), so it is ended and a new version is created; the 1448 adjustment moves to the new version and still applies. |
| Ramadan hours "1-30 Ramadan" in a 29-day Ramadan.                                                    | Ends on 29 Ramadan; 1 Shawwal is Eid or normal hours.                                                                                                    |
| A Gregorian holiday "30 December to 2 January".                                                      | Wraps: the occurrence of year Y covers Y-12-30 to (Y+1)-01-02.                                                                                           |
| "29 February" in 2027.                                                                               | Falls on 2027-02-28.                                                                                                                                     |
| A holiday on a Friday.                                                                               | No effect: Friday is already off.                                                                                                                        |
| A request accepted at 07:00, 20:00, on a Friday, or on a holiday.                                    | The clock starts at the next opening (fraction 0); the deadline lands at a closing time.                                                                 |
| A deadline lands inside a holiday added later.                                                       | The day is no longer working, so the deadline moves to the next working day at the same fraction (Phase 6 follows, Q7).                                  |
| Sara adds a holiday for today because work stopped this morning.                                     | 409 `CALENDAR_DATE_LOCKED` (Q10); she adds it for the following days only.                                                                               |
| A season with every weekday off.                                                                     | 400 `no_working_day`.                                                                                                                                    |
| A week with only Saturday working, and holidays covering many Saturdays.                             | Still terminates: holidays are at most 30 days long.                                                                                                     |
| A Hijri recurring period beyond 1600 AH.                                                             | Occurrences after the Umm al-Qura data end are not produced; a request in 2174 is not a concern.                                                         |
| Al-Noor is Read-only; Sara edits hours.                                                              | 403 `SUBSCRIPTION_READ_ONLY` (guard). `GET /calendar` still works.                                                                                       |
| Sara sends an Al-Rashid period ID.                                                                   | 404.                                                                                                                                                     |
| `GET /calendar/days` for 400 days.                                                                   | 400 `range_too_long`.                                                                                                                                    |

## 6. Security and Authorization

- **Trust boundaries:** every body validated by zod strict objects (T25); week shapes and dates validated in the service, with database checks as a second safeguard.
- **Tenant isolation:** application-level (T2); every repository function takes the tenant ID from the token; overrides reference periods through a composite foreign key.
- **Integrity of SLA outcomes:** the past-is-fixed rule is what stops a calendar edit from erasing a breach that already happened (Q7, Q10). It is enforced in one service function used by every write, against the database's date, under the calendar lock.
- **Authorization:** `calendar.view` and `calendar.manage`, organization scope only (T24, T26). The Tenant Admin role holds both with no data change (D21).
- **Audit:** every write in the same transaction (T8, MVP 3.9).

## 7. Implementation Steps

| Step                                  | Objective                                                                               | Delivers                                                                                                                                                                                                                                                              | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                       | Verification                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 4.1 Working-time core                 | The calendar's answers are correct before anything stores a rule.                       | `calendar/shared/`: week shapes, Hijri conversion, occurrence expansion with versions and overrides, precedence, `dayHours`, `addWorkingDays`, `workingDaysBetween`, the termination bound. No database.                                                              | R4.2 (shape), R4.4-R4.7, R4.9, R4.10 over in-memory calendars: every example in section 3; Umm al-Qura dates for Ramadan and Eid 1446-1448 match the announced Saudi dates; Hijri day 30 and 29 February clamping; year wrap; version boundaries; `workingDaysBetween(s, addWorkingDays(s, n)) = n` over randomized starts. Hijri conversion verified on the project's Node version (24). | Unit tests; a property test for the round trip.                                                                            |
| 4.2 Calendar storage and normal hours | Each tenant has a calendar whose hours can change for the future only.                  | Migration `0006` with backfill, default hours at tenant creation, `calendar.view` and `calendar.manage`, `loadCalendar`, `GET /calendar`, `GET /calendar/days`, `PUT` and `DELETE /calendar/hours/:effectiveFrom`, the calendar lock, the past-is-fixed check, audit. | R4.1-R4.3, R4.8 (hours), R4.11-R4.14: new and existing tenants have the default calendar; versions for future dates only; the day view reflects versions; permissions, Read-only, isolation, audit.                                                                                                                                                                                       | Integration tests; a race test of two writers that fails without the lock.                                                 |
| 4.3 Holidays and seasons              | Tenants define holidays and seasons, recurring and adjusted, without touching the past. | `POST`, `PATCH`, `DELETE /calendar/periods`, overrides `PUT` and `DELETE`, versioning (end and replace, adjustments moved), rank, validation, audit.                                                                                                                  | R4.4-R4.8, R4.11, R4.13, R4.14: one-off and recurring periods; Hijri placement in the day view; precedence; adjustments; edits during an occurrence; locked dates; `CALENDAR_PERIOD_ENDED`.                                                                                                                                                                                               | Integration tests, including the concurrent-edit race (fails without the lock); end-to-end check against a running server. |

Suggested order: 4.1, then 4.2, then 4.3, one at a time in the main session, as in Phases 1-3.
Close-out (status, decision promotion, `ROADMAP_AND_STATUS.md`) follows step 4.3.

## 8. Test Plan

Unit tests cover the pure calculation over in-memory calendars.
Integration tests run against real PostgreSQL with Al-Noor and Al-Rashid; the service reads today from the database, so tests choose dates relative to the database's today.

| Requirement      | Test                                                                                                                                                  | Step     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R4.2, R4.5, R4.6 | `dayHours` over normal hours, weekday spans, seasons, holidays, and precedence, including Founding Day inside Ramadan and overlapping ranked seasons. | 4.1      |
| R4.4, R4.7       | Occurrence expansion: Gregorian and Hijri, wrap, clamping, versions, moved and skipped years; Umm al-Qura 1446-1448 against announced dates.          | 4.1      |
| R4.9, R4.10      | The worked examples; outside-hours starts; the boundary convention; fractional n; round trip.                                                         | 4.1      |
| R4.1             | A new tenant and a backfilled tenant each have one default version.                                                                                   | 4.2      |
| R4.3, R4.8       | Future versions only; replace and delete future versions; locked versions; the lock under two connections.                                            | 4.2      |
| R4.4-R4.8        | Period create, edit, delete, adjust; edits before and after occurrences have begun; adjustments moved to the new version; locked dates.               | 4.3      |
| R4.11            | Day view over a Ramadan, Founding Day, and Eid range.                                                                                                 | 4.2, 4.3 |
| R4.12-R4.14      | Permission matrix (Huda view only), Read-only guard, audit rows, Al-Rashid IDs.                                                                       | 4.2, 4.3 |

## 9. Open Questions

Q1-Q8 were resolved in the pre-spec discussion with the owner on 2026-10-22; Q9 and Q10 in the review of this draft.

| #   | Question                                                                                                                                                                                            | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Resolution                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How precise are deadlines (MVP open question 3)?                                                                                                                                                    | (a) End of the Nth working day, counting from the next working day. (b) The acceptance day counts as day 1. (c) Exact time, with working hours.                                                                                                                                                                                                                                                                                                                                                                                                       | **Resolved 2026-10-22: (c)**, deadlines are moments in time, and the calendar has working hours (P4.1).                                                                         |
| Q2  | When working days differ in length (Ramadan), what does "N working days" mean?                                                                                                                      | (a) **Recommended:** a working day counts as one day whatever its length; a 5-day SLA in Ramadan is 5 Ramadan working days (D4). (b) An hours budget: N times a standard day length; short days stretch the deadline (5 days become 8 in Ramadan).                                                                                                                                                                                                                                                                                                    | **Resolved 2026-10-22: (a)**, every working day counts as one day, whatever its length (P4.2).                                                                                  |
| Q3  | Where inside the last day does the deadline land?                                                                                                                                                   | (a) **Recommended:** proportional: the start's fraction of its working day carries over, so the SLA is always exactly N days. (b) The same wall-clock time, moved back to closing when the day is shorter; sometimes more, sometimes less than N days.                                                                                                                                                                                                                                                                                                | **Resolved 2026-10-22: (a)**, proportional placement (P4.3).                                                                                                                    |
| Q4  | What shape do normal hours have?                                                                                                                                                                    | (a) One span per weekday. (b) The same span for every working day. (c) Several spans per day (breaks).                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Resolved 2026-10-22:** one default span for every working weekday; any weekday may have its own single span or be off; no breaks (P4.4).                                      |
| Q5  | Are recurring holidays supported, and what does "seasonal" cover?                                                                                                                                   | Seasonal working hours; Hijri-recurring holidays; Gregorian-recurring holidays; none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Resolved 2026-10-22:** all three: seasonal working hours, and holidays recurring on Hijri (Umm al-Qura) or Gregorian dates, with one-year adjustments and skips (P4.5, P4.6). |
| Q6  | What shape do seasonal hours have, and do seasons recur?                                                                                                                                            | Same shape as normal hours, or one span for the season; recurring or dated each year.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Resolved 2026-10-22:** seasons have the same shape as normal hours (default span, weekday spans or days off) and recur like holidays (P4.5).                                  |
| Q7  | What does a calendar change do to requests already accepted?                                                                                                                                        | (a) **Recommended:** the past is fixed; changes affect only the future; open requests' future deadlines follow; breaches and closed records never change. (b) Freeze each deadline at acceptance. (c) Always recompute from the current calendar, past included.                                                                                                                                                                                                                                                                                      | **Resolved 2026-10-22: (a)**, the past is fixed, and future deadlines of open requests follow changes (P4.7).                                                                   |
| Q8  | How are recurring rules stored, given the past is fixed and one-year adjustments?                                                                                                                   | (a) **Recommended:** versioned rules with effective dates, adjustments as override rows, expanded on the fly by a pure function. (b) Concrete rows generated per year ahead of time.                                                                                                                                                                                                                                                                                                                                                                  | **Resolved 2026-10-22: (a)**, versioned rules expanded on the fly; no generation job and no horizon (P4.8).                                                                     |
| Q9  | Which season sets the hours when two seasons overlap? Example: Ramadan (Hijri) and a June-August "summer hours" season overlap in years when Ramadan falls in summer (2014, and again around 2047). | (a) **Recommended:** an explicit `rank` per season, unique among the tenant's seasons; the higher rank wins. Sara ranks Ramadan above summer once, and it holds every year. (b) Reject a season whose occurrences would overlap another's in the coming years. Sara could then not have both seasons at all, because Ramadan moves through the Gregorian year. (c) A fixed rule (Hijri before Gregorian, then the shorter period). No setting, but an implicit rule nobody sees in the UI.                                                            | **Resolved 2026-10-22: (a)**, each season has an explicit `rank`, unique among the tenant's seasons; the higher rank sets the hours where seasons overlap (P4.9).               |
| Q10 | What is the earliest date a change may affect?                                                                                                                                                      | (a) **Recommended:** tomorrow. Today, once it has begun, is past enough to matter: a request accepted yesterday at 09:00 with a 1-day SLA had its deadline at 09:00 today; at 10:00 Sara marks today a holiday; the deadline moves to tomorrow, and the breach that R2 already reported disappears from the closure record. (b) Today: the whole of today can be redefined until midnight, accepting that example. (c) Now: today's remaining hours can change, its past hours cannot. Precise, but every rule needs a time of day as well as a date. | **Resolved 2026-10-22: (a)**, a change may affect dates from tomorrow on; today and earlier are locked (P4.7).                                                                  |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #     | Decision                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P4.1  | The calendar has working hours; deadlines and elapsed times are moments in `Asia/Riyadh`.                                                                                                                                                                     | Owner decision (Q1); resolves MVP open question 3 (precision).                                                                                                           |
| P4.2  | A working day counts as one day whatever its length.                                                                                                                                                                                                          | Owner decision (Q2): SLAs are promised in days (D4); shorter days do not stretch them.                                                                                   |
| P4.3  | Proportional placement: the start's fraction of its working day carries over; a start outside hours counts from the next opening; a result at a day's opening is reported at the previous working day's closing; results round down to the minute.            | Owner decision (Q3): always exactly N days, one rule with no clamping cases; R1's percentage uses the same measure.                                                      |
| P4.4  | Normal hours: a default span, with an optional own span or day off per weekday; at least one working weekday; no breaks.                                                                                                                                      | Owner decision (Q4); the working-weekday rule guarantees the calculation terminates.                                                                                     |
| P4.5  | Holidays and seasons are one model, `calendar_periods`, with a `kind`; both may be one-off, Gregorian-recurring, or Hijri-recurring; seasons carry a week shape and apply only to normally working days.                                                      | Owner decision (Q5, Q6); recurrence, adjustment, and versioning are written once.                                                                                        |
| P4.6  | Hijri dates use Umm al-Qura through the runtime's `Intl` (ICU); one year's occurrence can be moved or skipped to follow the official announcement.                                                                                                            | No dependency; Umm al-Qura is the Saudi civil calendar, and the moon sighting can differ by a day.                                                                       |
| P4.7  | The past is fixed: no change alters a day up to and including today; an edit of a recurring period with begun occurrences applies only to occurrences that start after today.                                                                                 | Owner decisions (Q7, Q10): a calendar edit can never erase a breach or rewrite a closed record, yet surprise holidays announced the day before still help open requests. |
| P4.8  | Hours and recurring periods are versioned by effective date; an edit of a version with begun occurrences ends it and creates a replacement; adjustments of future occurrences move to the replacement; the calendar is expanded on the fly by pure functions. | Owner decision (Q8): the rules of any past date stay in the tables; no generation job or horizon.                                                                        |
| P4.9  | Holidays win over seasons, seasons over normal hours; overlapping holidays combine; overlapping seasons are decided by an explicit rank.                                                                                                                      | Owner decision (Q9): every date has exactly one answer, and a tenant can keep seasons that overlap only in some years (Ramadan and summer hours).                        |
| P4.10 | Calendar writes take a per-tenant advisory lock keyed on `calendar:<tenant_id>`, like the seat lock (T17).                                                                                                                                                    | Two concurrent edits of one recurring period cannot both create a replacement version.                                                                                   |
| P4.11 | Week shapes are stored as `jsonb`, validated by zod.                                                                                                                                                                                                          | Always read whole, never queried by weekday; one shape shared by two tables.                                                                                             |
| P4.12 | Limits: holidays at most 30 days, seasons at most 184 days, dates at most 5 years ahead, day view at most 366 days; the next-working-day search stops after 3,660 days with an error.                                                                         | Keeps every calculation bounded; the error is a safety net, unreachable through validation.                                                                              |

Promote P4.1-P4.3 and P4.7 to `MVP_SCOPE.md` (with 3.2 and 3.6 updated and open question 3 struck), and P4.5, P4.6, P4.8, P4.10 to `TECHNICAL_DECISIONS.md`, when the phase is implemented.

## 11. Change Log

| Date       | Change                                                                                                             | Reason                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 2026-10-22 | Initial draft, with Q1-Q8 resolved in the pre-spec discussion.                                                     | Phase 4 spec requested. |
| 2026-10-22 | Resolved Q9 (explicit season rank) and Q10 (changes from tomorrow), each with the recommended option (P4.9, P4.7). | Owner review.           |
| 2026-10-22 | Spec approved; implementation started. | Owner approval. |
| 2026-10-22 | Step 4.1 implemented and verified: `calendar` module core (`calendar.config.ts`, `.types.ts`, `.schemas.ts` with `weekShapeSchema`; `shared/riyadh-time.ts`, `hijri.ts`, `occurrences.ts`, `week.ts` with `dayHours`, `working-time.ts` with `addWorkingDays`, `workingDaysBetween`, `CalendarExhaustedError`), Umm al-Qura through `Intl` with no dependency, verified on Node 24.21 (ICU 78.3). The announced Saudi dates are checked for 1446 and 1447 (Ramadan, Eid al-Fitr, Eid al-Adha); 1448 has not been announced yet, so its tests use the Umm al-Qura table (Ramadan 2027-02-08, 29 days; Eid al-Fitr 2027-03-09). Proposed for owner approval: `addWorkingDays(t, 0)` returns `t` itself (the boundary rule would otherwise move a start outside hours back to the previous closing, before the start); a date before the tenant's first hours version is not a working day, so the calculation is total instead of failing; sums of day fractions are rounded to 1e-9 before splitting into whole days, because `0.05 + 15 * 0.93` is `14.000000000000002` and would otherwise report the next opening instead of a closing. Also fixed: Biome formatting of `test/scopes.test.ts` (from Phase 3). | Acceptance criteria met; 59 unit tests, full suite 481 passing on Node 24; mutation checks: ignoring holidays, reversing season rank, dropping the boundary rule, the fraction rounding, the version end, the year wrap, the Hijri day-30 clamp, or the whole-minute offset in `fromRiyadh` each fail the matching tests. |
| 2026-10-22 | Step 4.1 approved by the owner with the go-ahead for step 4.2, including `addWorkingDays(t, 0)` returning `t`, no working day before the first hours version, and fraction rounding to 1e-9. | Owner approval. |
| 2026-10-22 | Step 4.2 implemented and verified: migration `0006_calendar` (`working_hours`, `calendar_periods`, `calendar_period_overrides`, three enums), `calendar.view` and `calendar.manage` in the catalog, default hours at tenant creation (audited `calendar.hours_set`, after the tenant's other entries), `loadCalendar`, `GET /calendar`, `GET /calendar/days`, `PUT` and `DELETE /calendar/hours/:effectiveFrom`, the calendar lock, the past-is-fixed check, `CALENDAR_DATE_LOCKED`; also checked end to end against a running server with Mailpit. Proposed for owner approval: the backfill is its own custom migration, `0007_calendar_backfill` (idempotent), so the Drizzle-generated `0006` stays untouched; a working-hours audit entry has resource type `working_hours` and its `effectiveFrom` as resource ID; by default `GET /calendar` leaves out ended versions and one-off periods already over, and lists periods in creation order; a `PUT` that changes nothing returns 200 with no audit entry, as role edits do; a `DELETE` of a missing version is 404 before the date check. | Acceptance criteria met; 16 integration tests, full suite 505 passing on Node 24; mutation checks: removing the lock, letting today change, dropping the tenant filter, dropping default hours at creation, a non-idempotent backfill, auditing a no-op, or dropping the five-year limit each fail the matching tests. |
