# Phase 11 API: Operator Console Requests

The endpoints of [phase-11-operator-console.md](phase-11-operator-console.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

## Draft form

No endpoint is added; every row changes an endpoint another phase owns.
Shapes not shown are unchanged in `docs/api/openapi.json`.
Besides these rows, the operation of every list endpoint (eleven, listed in spec 4.3) gains a `description` stating its order (R11.10).

| Method | Path | Realm | Permission | Request | Responses |
| ------ | ---- | ----- | ---------- | ------- | --------- |
| POST | `/operator/tenants` | operator | `platform.tenant.create` | unchanged | 201 `{data: TenantDetail}` with `tenant.owner` (R11.1); `owner.verificationEmail` is `failed` when the email could not be sent, and the tenant is still created (R11.2) |
| GET | `/operator/tenants` | operator | `platform.tenant.view` | query: `state` = `active` \| `grace` \| `read_only` \| `all` (default `all`); `q` text, trimmed, at most 100, blank is no filter; `cursor`, `limit` | 200 `{data: TenantDetail[], page}`, ordered by name then ID; `total` counts the filtered list (R11.5-R11.7) |
| GET | `/operator/tenants/:tenantId` | operator | `platform.tenant.view` | unchanged | 200 `{data: TenantDetail}` with `tenant.owner` (R11.1) |
| PUT | `/operator/tenants/:tenantId/subscription` | operator | `platform.subscription.update` | unchanged | 200 `{data: TenantDetail}` with `tenant.owner` (R11.1) |
| POST | `/operator/tenants/:tenantId/admin/resend-verification` | operator | `platform.tenant.create` | none | 200 `{data: TenantDetail}`, `owner.verificationEmail` the outcome of this send (was 204, and 500 on a failed send) (R11.3, Q2); 409 `ALREADY_VERIFIED` unchanged |
| POST | `/operator/plans` | operator | `platform.plan.create` | unchanged | 201 `{data: Plan}` with `discountedPriceHalalas` (R11.8) |
| GET | `/operator/plans` | operator | `platform.plan.view` | unchanged | 200 `{data: Plan[], page}`, newest first: `createdAt` desc, then `id` desc (R11.9) |
| GET | `/operator/plans/:planId` | operator | `platform.plan.view` | unchanged | 200 `{data: Plan}` with `discountedPriceHalalas` (R11.8) |
| PATCH | `/operator/plans/:planId` | operator | `platform.plan.update` | unchanged | 200 `{data: Plan}` with `discountedPriceHalalas` (R11.8) |
| GET | `/auth/me` | session | none | none | 200 `{data: Session}`, `user.platform` (R11.11) |
| POST | `/auth/login` | public | none | unchanged | 200 `{data: Session}`, `user.platform` (R11.11) |
| POST | `/auth/refresh` | public | none | none | 200 `{data: Session}`, `user.platform` (R11.11) |

### Shapes

```yaml
Tenant:
  required: [id, name, slug, owner, createdAt]   # ownerId removed
  properties:
    id: { type: string }
    name: { type: string }
    slug: { type: string }
    owner: { $ref: TenantOwner }
    createdAt: { type: string, format: date-time }

TenantOwner:
  required: [id, email, userName, verifiedAt, verificationEmail]
  properties:
    id: { type: string }
    email: { type: string }
    userName: { type: string }
    verifiedAt: { type: [string, "null"], format: date-time }   # null until the owner verifies and sets a password
    verificationEmail:
      type: [string, "null"]
      enum: [sent, failed, null]   # the last verification email; null once verified, or when no outcome is recorded

Plan:
  # every existing property, plus:
  required: [..., discountedPriceHalalas]
  properties:
    discountedPriceHalalas: { type: integer }   # priceHalalas after discountPercent, rounded half up to the halala

AuthUser:
  # every existing property, plus:
  required: [..., platform]
  properties:
    platform:
      type: [object, "null"]   # null for a tenant user
      required: [permissions]
      properties:
        permissions: { type: array, items: { type: string } }   # in catalog order
```

Examples (Omar reading Al-Noor before Sara verifies, after the email went out):

```json
{
  "data": {
    "tenant": {
      "id": "6c1f...",
      "name": "Al-Noor",
      "slug": "al-noor",
      "owner": {
        "id": "a93e...",
        "email": "sara@alnoor.sa",
        "userName": "Sara Al-Qahtani",
        "verifiedAt": null,
        "verificationEmail": "sent"
      },
      "createdAt": "2026-11-02T09:14:03.120Z"
    },
    "subscription": { "...": "unchanged" },
    "usage": { "...": "unchanged" }
  }
}
```

`GET /operator/tenants?state=grace&q=noor` answers the tenants in Grace whose name or slug contains `noor`, by name.

### Validation

No new detail codes. `state` uses `invalid_value` (R8.9); `q` uses `too_big` above 100 characters.

### New error codes

None.
