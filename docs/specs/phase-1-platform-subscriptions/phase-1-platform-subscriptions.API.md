# Phase 1 API: Platform, Plans & Subscriptions

The endpoints of [phase-1-platform-subscriptions.md](phase-1-platform-subscriptions.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Operator routes require an operator access token and send `Cache-Control: no-store`.
Dates are `YYYY-MM-DD` strings.

| Method | Path                                                    | Who         | Permission                     | Request                                                                                                      | Responses                                                                                                                                                                                    |
| ------ | ------------------------------------------------------- | ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/operator/plans`                                       | operator    | `platform.plan.create`         | `{name, userLimit, graceDays, priceHalalas, paymentPeriod, discountPercent?}`                                | 201 `{plan}`; 400; 409 `PLAN_NAME_TAKEN`                                                                                                                                                     |
| GET    | `/operator/plans`                                       | operator    | `platform.plan.view`           | none                                                                                                         | 200 `{plans:[...]}` ordered by name                                                                                                                                                          |
| GET    | `/operator/plans/:planId`                               | operator    | `platform.plan.view`           | none                                                                                                         | 200 `{plan}`; 404                                                                                                                                                                            |
| PATCH  | `/operator/plans/:planId`                               | operator    | `platform.plan.update`         | any of `{name, userLimit, graceDays, priceHalalas, paymentPeriod, discountPercent}`                          | 200 `{plan}`; 400; 404; 409 `PLAN_NAME_TAKEN`                                                                                                                                                |
| POST   | `/operator/tenants`                                     | operator    | `platform.tenant.create`       | `{name, slug, admin:{email, userName}, subscription:{planId, startDate, endDate, customerDiscountPercent?}}` | 201 `{tenant, subscription, admin:{id, email}}`; 400; 409 `EMAIL_TAKEN`, `SLUG_TAKEN`                                                                                                        |
| GET    | `/operator/tenants`                                     | operator    | `platform.tenant.view`         | none                                                                                                         | 200 `{tenants:[{id, name, slug, subscription:{..., state}, usage:{activeUsers, overLimit}}]}`                                                                                                |
| GET    | `/operator/tenants/:tenantId`                           | operator    | `platform.tenant.view`         | none                                                                                                         | 200 `{tenant, subscription, usage}`; 404                                                                                                                                                     |
| PUT    | `/operator/tenants/:tenantId/subscription`              | operator    | `platform.subscription.update` | `{planId, startDate, endDate, customerDiscountPercent?, reason?}`                                            | 200 `{subscription, usage}`; 400; 404                                                                                                                                                        |
| POST   | `/operator/tenants/:tenantId/admin/resend-verification` | operator    | `platform.tenant.create`       | none                                                                                                         | 204; 404; 409 `ALREADY_VERIFIED`                                                                                                                                                             |
| POST   | `/auth/verify`                                          | anyone      | none                           | `{token, password}`                                                                                          | 204; 400 `VALIDATION_FAILED` (password 12-256 characters); 400 `VERIFICATION_INVALID`                                                                                                        |
| GET    | `/subscription`                                         | tenant user | `subscription.view`            | none                                                                                                         | 200 `{subscription:{planName, userLimit, graceDays, startDate, endDate, graceEndsOn, state, pricing}, usage:{activeUsers, userLimit, overLimit}}`: everything the subscription holds (R1.11) |
| GET    | `/auth/me`                                              | any user    | none                           | (changed)                                                                                                    | Tenant users' response gains `subscription:{state, endDate, graceEndsOn}`                                                                                                                    |

Every subscription in a response carries `pricing: {priceHalalas, paymentPeriod, planDiscountPercent, customerDiscountPercent, effectivePriceHalalas}`.
Percentages are JSON numbers with up to two decimals (`15`, `12.5`).
`customerDiscountPercent` defaults to `0` when omitted on create, and keeps its current value when omitted on `PUT`.

## Permissions

| Permission                                                           | Allows                                   | Held by in the MVP          |
| -------------------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| `platform.plan.view`, `platform.plan.create`, `platform.plan.update` | Plan endpoints                           | Every operator              |
| `platform.tenant.view`, `platform.tenant.create`                     | Tenant endpoints                         | Every operator              |
| `platform.subscription.update`                                       | Subscription changes                     | Every operator              |
| `subscription.view`                                                  | `GET /subscription` (organization scope) | Tenant Admin (from Phase 3) |

The `platform.` prefix keeps operator permissions out of the tenant catalog, so a tenant role can never hold one.
Until Phase 3, `GET /subscription` is open to any tenant user; its content is low-sensitivity.

## Validation

- `name` (plan, tenant): trimmed, 1-100 characters. `slug`: lowercase letters, digits, and hyphens, 2-50 characters.
- `userLimit`: integer 1-100,000. `graceDays`: integer 0-365.
- `priceHalalas`: integer 0-100,000,000 (up to 1,000,000.00 SAR per period). `paymentPeriod`: `monthly` or `yearly`.
- `discountPercent`, `customerDiscountPercent`: number 0-100 with at most two decimals; `12.345` is rejected.
- `startDate` not after today; `endDate >= startDate`, with no minimum term (R1.2b). A past `endDate` ends a subscription early.
- Unknown `planId`: 400 `VALIDATION_FAILED` with detail code `unknown_plan`.
- `admin.email`: normalized (trim, lowercase), valid format. `admin.userName`: trimmed, 1-100 characters (Phase 0, P0.20).
- Non-UUID path IDs: 404 `NOT_FOUND`.

## New error codes

| HTTP | Code                                           | When                                                            |
| ---- | ---------------------------------------------- | --------------------------------------------------------------- |
| 400  | `VERIFICATION_INVALID`                         | Unknown, expired, or used verification token.                   |
| 409  | `ALREADY_VERIFIED`                             | Resend requested for an admin who has already verified.         |
| 403  | `SUBSCRIPTION_READ_ONLY`                       | Unsafe tenant request while Read-only (R1.9).                   |
| 403  | `SUBSCRIPTION_NOT_ACTIVE`                      | Route requires Active; tenant is in Grace or Read-only (R1.10). |
| 409  | `PLAN_NAME_TAKEN`, `EMAIL_TAKEN`, `SLUG_TAKEN` | Unique value already exists.                                    |
| 409  | `USER_LIMIT_REACHED`                           | Adding an active member would exceed the limit (R1.12).         |
