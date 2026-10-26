# Authentication

The API authenticates with two cookies and no `Authorization` header.
The code is in `src/modules/auth/`.

## Cookies

| Cookie | Holds | Lifetime | Flags |
| ------ | ----- | -------- | ----- |
| `wq_access` | A signed JWT access token | 30 minutes | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| `wq_refresh` | An opaque refresh token | 7 days | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/auth` |

- JavaScript cannot read either cookie, so a client never handles a token: it only sends requests with credentials (`fetch(..., {credentials: "include"})`).
- `wq_refresh` is sent only to `/auth/*` routes.
- Browsers treat `http://localhost` as secure, so the cookies work in local development.
- Only the SHA-256 hash of a refresh token is stored.

## Sign in, refresh, sign out

| Endpoint | Needs | Result |
| -------- | ----- | ------ |
| `POST /auth/login` | `{email, password}` | 200 the session (`{user, subscription}`) and both cookies; 401 `INVALID_CREDENTIALS` for any failure |
| `POST /auth/refresh` | the `wq_refresh` cookie | 200 the session and new cookies; the old refresh token is revoked; 401 `UNAUTHENTICATED` with both cookies cleared if the token is unknown, revoked, or expired, or the user is inactive |
| `POST /auth/logout` | nothing | 204; the refresh token is revoked and both cookies are cleared |
| `GET /auth/me` | the `wq_access` cookie | 200 the session; 401 `UNAUTHENTICATED` |

- The session is the same object from all three calls: `user` is `{id, email, userName, role, tenant}`, and `subscription` is `{state, endDate, graceEndsOn}` for a tenant user and `null` for an operator.
- `role` is `user` for a tenant user and `operator` for a platform operator.
  `tenant` is `{id, roleId, roleName, permissions}` for a tenant user and `null` for an operator.
- A login failure never says whether the email exists, the password was wrong, or the user is not active yet.
- Refresh tokens rotate on every refresh, so a stolen token works at most once.

A client keeps the session alive in this order:

1. A call answers 401 `UNAUTHENTICATED`.
2. The client calls `POST /auth/refresh` once.
3. On 200 it retries the original call; on 401 it shows the login page.

A deactivated user keeps a valid access token for at most 30 minutes, and the next refresh fails.
Calls that change data check the user in the database as well (`access.md`), so a deactivated member's old token cannot act.

## The access-token payload

The token is an HS256 JWT.
A client does not need to decode it (it is `HttpOnly`); `GET /auth/me` returns the same facts.

```json
{
  "sub": "<user id>",
  "iss": "watheeq_api",
  "iat": 1792000000,
  "exp": 1792001800,
  "username": "Faisal",
  "email": "faisal@alnoor.example",
  "role": "user",
  "tenant": {
    "id": "<tenant id>",
    "roleId": "<role id>",
    "roleName": "Head of Contracts",
    "permissions": ["org.view", "user.view", "request.view"]
  }
}
```

- `permissions` is a list of permission keys; the scope of each is resolved inside each query from the caller's current unit, so a move or a role edit applies to which rows a caller sees on the next call (`access.md`).
- A role change reaches the token at its next refresh, within 30 minutes.
  Writes that grant power are checked against the database instead (`PERMISSION_NOT_HELD` in `errors.md`).

## Passwords and emailed links

| Endpoint | Needs | Result |
| -------- | ----- | ------ |
| `POST /auth/verify` | `{token, password}` | 204; the user sets a first password from an invitation or verification link; 400 `VERIFICATION_INVALID` for an unknown, used, replaced, or expired link |
| `POST /auth/password` | signed in; `{currentPassword, newPassword}` | 204; the user's other sessions are signed out; 401 `INVALID_CREDENTIALS` for a wrong current password |
| `POST /auth/password-reset/request` | `{email}` | 204 always, so the answer never reveals whether the email has an account |
| `POST /auth/password-reset` | `{token, password}` | 204; the user's sessions are signed out; 400 `VERIFICATION_INVALID` |

- A password is 12 to 256 characters.
- Links are emailed to the user and open the web app: `${APP_BASE_URL}/verify-email?token=...` for the first Tenant Admin and for invited members, and `${APP_BASE_URL}/reset-password?token=...` for a reset.
  The app reads the token from the address and posts it with the new password.
- An invitation or verification link lasts 72 hours and a reset link 1 hour.
  A link works once, and a newer link for the same purpose, or the user's deactivation, ends it.
- A user who has not opened their link has no password yet: their login fails exactly like an unknown email.
- None of the `/auth/*` routes is behind the subscription guard, so a user of a Read-only tenant can always sign in, refresh, sign out, and change their password (`access.md`).

## Operators

A platform operator has role `operator`, no tenant, and no `tenant` claim; operator routes under `/operator` require that role and answer 403 `FORBIDDEN` to a tenant user.
Operators are created from the command line (`pnpm operator:create`), never through the API.
