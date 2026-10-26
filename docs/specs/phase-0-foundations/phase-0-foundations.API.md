# Phase 0 API: Technical Foundations

The endpoints of [phase-0-foundations.md](phase-0-foundations.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

| Method | Path            | Who            | Request             | Responses                                                                                                                 |
| ------ | --------------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`       | anyone         | none                | 200 `{status:"ok", db:"up"}`; 503 `SERVICE_UNAVAILABLE`                                                                |
| POST   | `/auth/login`   | anyone         | `{email, password}` | 200 the session, as `GET /auth/me`, and both cookies; 400 `VALIDATION_FAILED`; 401 `INVALID_CREDENTIALS`            |
| POST   | `/auth/refresh` | refresh cookie | none                | 200 the session, as `GET /auth/me`, and new access and refresh cookies (rotation); 401 `UNAUTHENTICATED`                  |
| POST   | `/auth/logout`  | anyone         | none                | 204; the presented refresh token is revoked and both cookies are cleared                                                  |
| GET    | `/auth/me`      | access cookie  | none                | 200 the session `{user:{id, email, userName, role, tenant}, subscription}`; 401 `UNAUTHENTICATED`                    |

`tenant` is `{id, roleId, roleName, permissions}` for a tenant user and `null` for an operator (P0.18).
`/auth/verify` (email verification) is designed in Phase 1.

## Standard error shape

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "requestId": "8f2c...",
    "details": [{ "path": "email", "code": "invalid_format" }]
  }
}
```

| HTTP | Code                     | When                                                                             |
| ---- | ------------------------ | -------------------------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`      | zod validation failed, or the body parser refused the body (malformed JSON, a size that does not match `Content-Length`). |
| 401  | `UNAUTHENTICATED`        | Missing, invalid, or expired token.                                              |
| 401  | `INVALID_CREDENTIALS`    | Login failed.                                                                    |
| 403  | `FORBIDDEN`              | Authenticated, but not allowed (for example a tenant user on an operator route). |
| 404  | `NOT_FOUND`              | Unknown route or resource, or a path parameter that cannot be decoded (`/users/%zz`), answered like any unknown ID. |
| 409  | `TAKEN`                  | The email belongs to an existing account (translated centrally from `users_email_unique`, P0.14), with the detail `{path: "email", code: "taken"}`. |
| 413  | `PAYLOAD_TOO_LARGE`      | Body over 100 KB.                                                                |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Body sent without `Content-Type: application/json`.                              |
| 500  | `INTERNAL`               | Anything unexpected.                                                             |

There is no human-readable `message`; clients map `code` to Arabic or English text (T11).
`details` is always present, an empty array when there is nothing to point at.

## Cookies

| Cookie       | Holds         | Flags                                                                         |
| ------------ | ------------- | ----------------------------------------------------------------------------- |
| `wq_access`  | Access token  | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`                                |
| `wq_refresh` | Refresh token | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/auth` (sent only to auth routes) |

Browsers treat `http://localhost` as a secure context, so `Secure` works in local development.
