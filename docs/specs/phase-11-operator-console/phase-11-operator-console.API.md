# Phase 11 API: Operator Console Requests

The endpoints of [phase-11-operator-console.md](phase-11-operator-console.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

No endpoint is added; every row is an endpoint another phase owns that this phase changed.

| Method | Path                                                    | Who                            | Purpose                                                                                       | Spec refs           |
| ------ | ------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------- |
| POST   | `/operator/tenants`                                     | `platform.tenant.create`       | (changed) Answers `tenant.owner`; a failed verification email shows `failed`                  | R11.1, R11.2        |
| GET    | `/operator/tenants`                                     | `platform.tenant.view`         | (changed) Filters by `state` and searches name or slug with `q`; items carry `tenant.owner`   | R11.1, R11.5-R11.7  |
| GET    | `/operator/tenants/:tenantId`                           | `platform.tenant.view`         | (changed) Answers `tenant.owner`                                                              | R11.1               |
| PUT    | `/operator/tenants/:tenantId/subscription`              | `platform.subscription.update` | (changed) Answers `tenant.owner`                                                              | R11.1               |
| POST   | `/operator/tenants/:tenantId/admin/resend-verification` | `platform.tenant.create`       | (changed) Answers the tenant, with this send's outcome; a failed send is not an error         | R11.3, P11.2        |
| POST   | `/operator/plans`                                       | `platform.plan.create`         | (changed) Answers `discountedPriceHalalas`                                                    | R11.8, P11.7        |
| GET    | `/operator/plans`                                       | `platform.plan.view`           | (changed) Newest first; items carry `discountedPriceHalalas`                                  | R11.8, R11.9        |
| GET    | `/operator/plans/:planId`                               | `platform.plan.view`           | (changed) Answers `discountedPriceHalalas`                                                    | R11.8               |
| PATCH  | `/operator/plans/:planId`                               | `platform.plan.update`         | (changed) Answers `discountedPriceHalalas`                                                    | R11.8               |
| GET    | `/auth/me`                                              | any user                       | (changed) `user.platform`: an operator's platform permissions, `null` for a tenant user       | R11.11, R11.12      |
| POST   | `/auth/login`                                           | public                         | (changed) `user.platform`, as `/auth/me`                                                      | R11.11              |
| POST   | `/auth/refresh`                                         | public                         | (changed) `user.platform`, as `/auth/me`                                                      | R11.11              |

## Rules a schema does not state

- Every list operation's `description` in `openapi.json` states its order (R11.10, P11.8); the texts are in spec 4.3.
- `GET /operator/plans` was ordered by name before this phase; a cursor issued then is 400 `invalid_cursor`.
- `owner.verificationEmail` is `sent` when the mail server accepted the newest verification email, not that it was delivered; it is `null` once the owner has verified, or when no outcome is recorded (a link sent before this phase) (P11.2).
- `state` is the subscription state of today's Riyadh date, the same rule as `subscription.state` (P11.5); a tenant can leave a `state` page between two pages at midnight.
- `q` is matched against the tenant's name and slug, ignoring case, with `%`, `_`, and `\` matched literally, as on `GET /users` (P11.6).
- Invitations a Tenant Admin sends (`POST /users`, the user resend) record their email outcome too, but no answer shows it yet; their answers are unchanged (R11.4).
- `user.platform.permissions` and the operator route checks come from one function (R11.12, P11.9).
