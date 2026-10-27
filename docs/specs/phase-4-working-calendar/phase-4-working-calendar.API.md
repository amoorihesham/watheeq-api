# Phase 4 API: Working Calendar

The endpoints of [phase-4-working-calendar.md](phase-4-working-calendar.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, the subscription guard (T16), and `requireTenantPermission(...)`.
In Read-only, every write below is refused by the guard.
All dates are Riyadh dates (`YYYY-MM-DD`); all times are Riyadh wall-clock times (`HH:MM`).

| Method | Path                                          | Who               | Purpose                                                                                  | Spec refs                |
| ------ | --------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| GET    | `/calendar`                                   | `calendar.view`   | Every hours version and the holidays and seasons, ended versions only on request         | R4.1, R4.3, R4.12        |
| GET    | `/calendar/days`                              | `calendar.view`   | The day view of up to 366 days: Hijri date, working or not, hours, holidays, season     | R4.6, R4.11              |
| PUT    | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | Set the working hours that take effect from a future date, as a new version              | R4.2, R4.3, R4.8         |
| DELETE | `/calendar/hours/:effectiveFrom`              | `calendar.manage` | Remove a future hours version                                                            | R4.3, R4.8               |
| POST   | `/calendar/periods`                           | `calendar.manage` | Create a holiday or a season, one-off or recurring on Gregorian or Umm al-Qura dates     | R4.4, R4.5, R4.8         |
| PATCH  | `/calendar/periods/:periodId`                 | `calendar.manage` | Edit a period; a version that already ran is ended and replaced by a new one             | R4.4, R4.5, R4.8         |
| DELETE | `/calendar/periods/:periodId`                 | `calendar.manage` | Delete a period, or end its current version                                              | R4.8                     |
| PUT    | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | Move one year's occurrence of a recurring period to other dates, or skip it              | R4.7, R4.8               |
| DELETE | `/calendar/periods/:periodId/overrides/:year` | `calendar.manage` | Remove one year's adjustment                                                             | R4.7, R4.8               |

## Rules a schema does not state

- The past is fixed: a change that would alter a day up to and including today is 409 `CALENDAR_DATE_LOCKED`; a period version already ended by an earlier edit is 409 `CALENDAR_PERIOD_ENDED`, and the client reloads (R4.8).
- A `DELETE` of a missing hours version is 404 before the date check.
- `kind` and `recurrence` of a period cannot change; a different kind of period is a new period.
- A recurring period is created with `validFrom` set to tomorrow.
- A period always has every key; the keys its kind and recurrence do not use are `null`.
  Every field a kind uses is required, so a `PATCH` has nothing a `null` could clear, and `null` is refused (`invalid_type`).
- `next` in a period is the next occurrence's Gregorian range after adjustments, so a client shows "Eid al-Fitr: 2027-03-09 to 2027-03-12" without converting Hijri dates itself.
- `GET /calendar` lists periods in creation order and, unless `includeEnded` is set, leaves out period versions ended by an edit or a delete and one-off periods already over.
- Week shape: every weekday present; at least one working weekday (`no_working_day`); a `custom` day needs `start` and `end` (`required`), and a `default` or `off` day refuses them (`not_allowed`) (Phase 8, R8.4).
- Dates and `:effectiveFrom` are valid Riyadh dates at most 5 years after today (`too_far_ahead`).
- A one-off range or moved occurrence has `startDate <= endDate` (`end_before_start`); a holiday is at most 30 days and a season at most 184 days (`period_too_long`), also checked on a recurring rule's longest possible occurrence.
- Gregorian 29 February is allowed and falls on 28 February in other years; Hijri day 30 falls on the 29th in a 29-day month; a day the month cannot have is `invalid_day`.
- Overrides are only for recurring periods (`not_recurring`) and only for a year the version has an occurrence in (`no_occurrence`), so Hijri years outside the Umm al-Qura data (1300-1600 AH) are refused.
- `rank` is an integer 0-100, unique among the tenant's seasons in force (`rank_taken`).
