# Phase 4 API: Working Calendar

The endpoints of [phase-4-working-calendar.md](phase-4-working-calendar.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
In Read-only, every write below is refused by the guard.
All dates are Riyadh dates (`YYYY-MM-DD`); all times are Riyadh wall-clock times (`HH:MM`).

| Method | Path                                          | Permission        | Request                                                     | Responses                                                                                                         |
| ------ | --------------------------------------------- | ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/calendar`                                   | `calendar.view`   | `includeEnded?` (default false)                             | 200 `{today, hours:[hours version], periods:[period]}`                                                            |
| GET    | `/calendar/days`                              | `calendar.view`   | `from`, `to` (at most 366 days)                             | 200 `{from, to, days:[day]}`; 400                                                                                 |
| PUT    | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | a week shape                                                | 200 the hours version, as in `GET /calendar`'s `hours`; 400; 409 `CALENDAR_DATE_LOCKED`                           |
| DELETE | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`                                                                              |
| POST   | `/calendar/periods`                           | `calendar.manage` | a period definition                                         | 201 the period, as in `GET /calendar`'s `periods`; 400; 409 `CALENDAR_DATE_LOCKED`                                |
| PATCH  | `/calendar/periods/:periodId`                 | `calendar.manage` | any fields of the definition except `kind` and `recurrence` | 200 the period (a new ID when a version was ended); 400; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED` |
| DELETE | `/calendar/periods/:periodId`                 | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED`                                                     |
| PUT    | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | `{action:"move", startDate, endDate}` or `{action:"skip"}`  | 200 the period; 400; 404; 409 `CALENDAR_DATE_LOCKED`, `CALENDAR_PERIOD_ENDED`                                     |
| DELETE | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | none                                                        | 204; 404; 409 `CALENDAR_DATE_LOCKED`                                                                              |

A **period definition** (the request): `{kind, name, recurrence, startDate?, endDate?, start?: {month, day}, end?: {month, day}, week?, rank?}`.
An **hours version** (`data` of the hours write, an entry of `GET /calendar`'s `hours`): `{effectiveFrom, week}`, where `week` is `{start, end, days}` and each day is `"default"`, `"off"`, or `{start, end}`.
A **period** (`data` of a period or override write, an entry of `GET /calendar`'s `periods`) always has every key; the keys its kind and recurrence do not use are `null`:
`{id, name, kind, recurrence, startDate, endDate, start, end, validFrom, validUntil, overrides, week, rank, replacesId, next}`.
`startDate` and `endDate` belong to a one-off period, `start`, `end`, `validFrom`, `validUntil`, and `overrides` to a recurring one (`overrides` is `[]` for a one-off), and `week` and `rank` to a season.
An override is `{year, action, startDate, endDate}`, with the dates `null` for a skip.
`next` is the next occurrence's Gregorian range `{startDate, endDate}` after adjustments, or `null`, so a client shows "Eid al-Fitr: 2027-03-09 to 2027-03-12" without converting Hijri dates itself.
A recurring period is created with `validFrom` = tomorrow.
`kind` and `recurrence` cannot change; a different kind of period is a new period.
A **day**: `{date, hijriDate: {year, month, day}, working, start, end, holidays:[{id, name}], season}`; `start` and `end` are `null` on a day off, and `season` is `{id, name}` or `null`.

`GET /calendar` lists every hours version (they are few) and, unless `includeEnded`, leaves out period versions ended by an edit or a delete and one-off periods already over; periods are listed in creation order.
A `DELETE` of a missing hours version is 404 before the date check.

## Validation

- Times: `HH:MM`, 00:00 to 24:00; `start < end`.
- Week shape: every weekday present; at least one working weekday (`no_working_day`).
- Dates and `:effectiveFrom`: valid Riyadh dates, at most 5 years after today (`too_far_ahead`).
- One-off range and moved occurrence: `startDate <= endDate` (`end_before_start`); a holiday at most 30 days, a season at most 184 days (`period_too_long`), also checked on recurring rules' longest possible occurrence.
- Recurring days: a valid month and day; Gregorian 29 February is allowed and falls on 28 February in other years; Hijri day 30 falls on the 29th in a 29-day month.
- A definition is checked whole, also after a `PATCH`: a field its kind or recurrence needs is `required`, one it does not take is `not_allowed`; a day the month cannot have is `invalid_day`.
- Overrides: only on recurring periods (`not_recurring`); only for a year the version has an occurrence in (`no_occurrence`), so Hijri years outside the Umm al-Qura data (1300-1600 AH) are refused.
- `rank`: an integer 0-100, unique among the tenant's seasons in force (`rank_taken`).

## New error codes

| HTTP | Code                    | When                                                                                   |
| ---- | ----------------------- | -------------------------------------------------------------------------------------- |
| 409  | `CALENDAR_DATE_LOCKED`  | The change would alter a day up to and including today (R4.3, R4.8).                   |
| 409  | `CALENDAR_PERIOD_ENDED` | The period version was already ended by an earlier edit or delete; the client reloads. |
