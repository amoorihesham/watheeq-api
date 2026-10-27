# Phase 0 API: Technical Foundations

The endpoints of [phase-0-foundations.md](phase-0-foundations.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`; the error shape, the codes, and the cookies are in `docs/api/errors.md` and `docs/api/auth.md`.

| Method | Path            | Who            | Purpose                                                                  | Spec refs    |
| ------ | --------------- | -------------- | ------------------------------------------------------------------------ | ------------ |
| GET    | `/health`       | public         | Report whether the database is reachable                                 | R0.1         |
| POST   | `/auth/login`   | public         | Log in with email and password; sets the access and refresh cookies      | R0.10, R0.11 |
| POST   | `/auth/refresh` | refresh cookie | Rotate the refresh token, checked in the database, and set new cookies   | R0.12a       |
| POST   | `/auth/logout`  | public         | Revoke the presented refresh token and clear both cookies                | R0.12        |
| GET    | `/auth/me`      | access cookie  | The signed-in user and, for a tenant user, their tenant and subscription | R0.11        |

A wrong email, a wrong password, and an inactive account get the same login answer (R0.10).
`tenant` is `null` for an operator (P0.18).
`/auth/verify` (email verification) is designed in Phase 1.
