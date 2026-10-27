# Phase 1 API: Platform, Plans & Subscriptions

The endpoints of [phase-1-platform-subscriptions.md](phase-1-platform-subscriptions.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Operator routes require an operator access token and send `Cache-Control: no-store`.

| Method | Path                                                    | Who                            | Purpose                                                                                     | Spec refs         |
| ------ | ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------- |
| POST   | `/operator/plans`                                       | `platform.plan.create`         | Create a plan with price, payment period, and discount                                      | R1.1, R1.14       |
| GET    | `/operator/plans`                                       | `platform.plan.view`           | List plans by name                                                                          | R1.1              |
| GET    | `/operator/plans/:planId`                               | `platform.plan.view`           | One plan                                                                                    | R1.1              |
| PATCH  | `/operator/plans/:planId`                               | `platform.plan.update`         | Edit a plan; existing subscriptions keep their copied terms                                 | R1.1, R1.2        |
| POST   | `/operator/tenants`                                     | `platform.tenant.create`       | Create a tenant with its subscription and first Tenant Admin, who gets a verification email | R1.3, R1.4, R1.5  |
| GET    | `/operator/tenants`                                     | `platform.tenant.view`         | List tenants by name with subscription and usage                                            | R1.15             |
| GET    | `/operator/tenants/:tenantId`                           | `platform.tenant.view`         | One tenant with subscription and usage                                                      | R1.15             |
| PUT    | `/operator/tenants/:tenantId/subscription`              | `platform.subscription.update` | Renew, extend, change, or end a subscription by setting its plan and period                 | R1.6, R1.8, R1.13 |
| POST   | `/operator/tenants/:tenantId/admin/resend-verification` | `platform.tenant.create`       | Resend the first Tenant Admin's verification link                                           | R1.4              |
| POST   | `/auth/verify`                                          | public                         | Verify the email and set the password with the link's token                                 | R1.4              |
| GET    | `/subscription`                                         | `subscription.view`            | The caller's subscription with its state, pricing, and usage                                | R1.11             |
| GET    | `/auth/me`                                              | any user                       | (changed) Adds `subscription`: its state for a tenant user, `null` for an operator          | R1.7, R1.11       |

Every subscription in a response carries `pricing`, the effective price per payment period (R1.2a).
`customerDiscountPercent` defaults to `0` when omitted on create, and keeps its current value when omitted on `PUT`.

## Permissions

| Permission                                                           | Allows                                   | Held by in the MVP          |
| -------------------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| `platform.plan.view`, `platform.plan.create`, `platform.plan.update` | Plan endpoints                           | Every operator              |
| `platform.tenant.view`, `platform.tenant.create`                     | Tenant endpoints                         | Every operator              |
| `platform.subscription.update`                                       | Subscription changes                     | Every operator              |
| `subscription.view`                                                  | `GET /subscription` (organization scope) | Tenant Admin (from Phase 3) |

The `platform.` prefix keeps operator permissions out of the tenant catalog, so a tenant role can never hold one.

## Rules a schema does not state

- `startDate` is not after today and `endDate >= startDate`, with no minimum term (R1.2b); a past `endDate` ends a subscription early.
- An unknown `planId` is 400 `VALIDATION_FAILED` with the detail code `unknown_plan`.
- A non-UUID path ID is 404 `NOT_FOUND`.
