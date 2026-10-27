# Phase 8 API: API Contract

The endpoints of [phase-8-api-contract.md](phase-8-api-contract.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Every endpoint changed to the shapes of section 4.2: success bodies inside `data`, lists as `{data, page}`, errors with `details` always present.
This file lists only the endpoints whose contract changed beyond that, each with its change in Purpose; the endpoint itself belongs to the phase that designed it.

## Lists

Every list gained `cursor` and `limit` (1-100, default 25) and answers `{data: [item], page: {nextCursor, total}}` (R8.5-R8.9).

| Method | Path                | Who                        | Purpose                                                                                     | Spec refs    |
| ------ | ------------------- | -------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| GET    | `/operator/plans`   | `platform.plan.view`       | (changed) A page of plans                                                                   | R8.5, R8.6   |
| GET    | `/operator/tenants` | `platform.tenant.view`     | (changed) A page of tenant details `{tenant, subscription, usage}`                          | R8.5, Q18    |
| GET    | `/users`            | `user.view`                | (changed) A page of users; `offset` is removed                                              | R8.5, R8.9   |
| GET    | `/roles`            | `role.view`                | (changed) A page of roles                                                                   | R8.5         |
| GET    | `/permissions`      | `role.view`                | (changed) A page of catalog entries                                                         | R8.5         |
| GET    | `/positions`        | `position.view`            | (changed) A page of positions; `includeRetired` becomes `retired`                           | R8.5, R8.9   |
| GET    | `/priorities`       | `priority.view`            | (changed) A page of priorities; `includeRetired` becomes `retired`                          | R8.5, R8.9   |
| GET    | `/services`         | `service.view`             | (changed) A page of services; `includeRetired` becomes `retired`                            | R8.5, R8.9   |
| GET    | `/workflows`        | `workflow.view`            | (changed) A page of workflow summaries; `includeRetired` becomes `retired`                  | R8.5, R8.9   |
| GET    | `/requests`         | anyone; rows by visibility | (changed) A page of request summaries; `offset` is removed; the ID order becomes descending | R8.5, R8.6   |
| GET    | `/notifications`    | any user                   | (changed) A page of notifications; `before` is removed and `hasMore` becomes `page.nextCursor` | R8.5, R8.6 |

## Other endpoints

| Method | Path                                        | Who                            | Purpose                                                                                           | Spec refs  |
| ------ | ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | ---------- |
| GET    | `/health`                                   | public                         | (changed) 503 `SERVICE_UNAVAILABLE` when the database is unreachable                              | R8.12      |
| POST   | `/auth/login`                               | public                         | (changed) Answers the session, as `GET /auth/me`                                                  | R8.2, Q17  |
| POST   | `/auth/refresh`                             | refresh cookie                 | (changed) Answers the session, as `GET /auth/me`                                                  | R8.2, Q17  |
| POST   | `/operator/tenants`                         | `platform.tenant.create`       | (changed) Answers the tenant detail, no longer `admin`                                            | R8.2, Q18  |
| GET    | `/operator/tenants/:tenantId`               | `platform.tenant.view`         | (changed) Answers the tenant detail                                                               | R8.2, Q18  |
| PUT    | `/operator/tenants/:tenantId/subscription`  | `platform.subscription.update` | (changed) Answers the tenant detail, was `{subscription, usage}`                                  | R8.2, Q18  |
| PUT    | `/priorities/order`                         | `priority.manage`              | (changed) Answers 204                                                                             | R8.3, Q19  |
| GET    | `/escalation`                               | `escalation.view`              | (changed) `settings` is `null` until saved                                                        | R8.4       |
| GET    | `/calendar/days`                            | `calendar.view`                | (changed) A day's `start`, `end`, and `season` are `null` when absent                             | R8.4       |
| GET    | `/requests/:requestId`                      | visibility                     | (changed) Every answer has `files`, `null` for non-file fields; a removed file's details are `null` | R8.4     |
| POST   | `/requests/:requestId/information-requests` | the handler or a stage assignee | (changed) Answers 200, was 201: no new resource with its own URL                                  | R8.3       |
| PUT    | `/services/:serviceId/form`                 | `service.manage`               | (changed) Every field has every key, `null` where its type has none; a field may be sent as read  | R8.4, Q22  |
| PUT    | `/calendar/hours/:effectiveFrom`            | `calendar.manage`              | (changed) Every weekday is `{mode, start, end}` in the request and the response                   | R8.4, Q23  |

Unique-value conflicts answer 409 `TAKEN` at the field, and `PUT /workflows/:workflowId` and `PUT /services/:serviceId/form` answer 409 `VERSION_CHANGED`; the codes are in `docs/api/errors.md` (R8.11).
