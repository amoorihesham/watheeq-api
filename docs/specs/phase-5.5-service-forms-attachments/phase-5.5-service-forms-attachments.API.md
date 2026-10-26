# Phase 5.5 API: Service Forms and File Storage

The endpoints of [phase-5.5-service-forms-attachments.md](phase-5.5-service-forms-attachments.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).

| Method | Path                          | Permission                  | Request                                                                                                    | Responses                                                                                                                                                                                        |
| ------ | ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/services/:id`               | `service.view`              |                                                                                                            | (changed) the service now includes `form: {revision, fields}`                                                                                                                                    |
| PUT    | `/services/:id/form`          | `service.manage`            | `{baseRevision, fields:[field]}`                                                                           | 200 `{service}`; 400; 404; 409 `SERVICE_FORM_CHANGED`, `RESOURCE_RETIRED`                                                                                                                        |
| POST   | `/files`                      | active member (Q9)          | query `name=<name>`; the file's bytes, `Content-Type: application/octet-stream`, `Content-Length` required | 201 `{file}`; 400 `invalid_name`, `empty_file`, `length_mismatch`; 409 `UPLOAD_QUOTA_REACHED`, `STORAGE_LIMIT_REACHED`; 411 `LENGTH_REQUIRED`; 413 `FILE_TOO_LARGE`; 415 `FILE_TYPE_NOT_ALLOWED` |
| POST   | `/operator/plans`             | `platform.plan.create`      | (changed) `storageLimitGb` required on create                                                              | as Phase 1                                                                                                                                                                                       |
| PATCH  | `/operator/plans/:planId`     | `platform.plan.update`      | (changed) `storageLimitGb` allowed on update                                                               | as Phase 1                                                                                                                                                                                       |
| GET    | `/subscription`               | as Phase 1                  |                                                                                                            | (changed) `subscription.storageLimitGb`; `usage.storage: {usedBytes, limitBytes, overLimit}`                                                                                                     |
| GET    | `/operator/tenants/:tenantId` | as Phase 1                  |                                                                                                            | (changed) `subscription.storageLimitGb`; `usage.storage: {usedBytes, limitBytes, overLimit}`                                                                                                     |
| GET    | `/files/:id`                  | the uploader, while pending |                                                                                                            | 200 `{file}`; 404                                                                                                                                                                                |
| GET    | `/files/:id/content`          | the uploader, while pending |                                                                                                            | 200 the bytes as a download; 404                                                                                                                                                                 |
| DELETE | `/files/:id`                  | the uploader, while pending |                                                                                                            | 204; 404                                                                                                                                                                                         |

Shapes:

- **Field (request):** as in 4.1, with `id` omitted for a new field or option.
  Settings that do not belong to the type are `unknown_field` (T25); every setting of the type is required (`min` and `max` may be null).
- **File:** `{id, name, contentType, size, sha256, expiresAt}`.

`GET /files/:id` for a file that is not the caller's pending upload is 404, whoever owns it, so a file ID reveals nothing; Phase 6 adds the routes for attached files.
`DELETE` marks the upload `discarded`, so it disappears at once and the sweep deletes its bytes and row; a discarded upload was never part of any record.
The file name travels in the query string, percent-encoded, so Arabic names need no special header encoding.

## New error codes

| HTTP | Code                    | When                                                                      |
| ---- | ----------------------- | ------------------------------------------------------------------------- |
| 409  | `SERVICE_FORM_CHANGED`  | `baseRevision` is not the current revision.                               |
| 409  | `UPLOAD_QUOTA_REACHED`  | The uploader already has 20 pending uploads.                              |
| 409  | `STORAGE_LIMIT_REACHED` | Usage plus the declared size would pass the subscription's storage limit. |
| 411  | `LENGTH_REQUIRED`       | An upload without `Content-Length` (for example a chunked body).          |
| 413  | `FILE_TOO_LARGE`        | `Content-Length` over 25 MB.                                              |
| 415  | `FILE_TYPE_NOT_ALLOWED` | The detected type is not allowed, or does not match the extension.        |

Validation detail codes: `duplicate_label`, `duplicate_option` (a repeated option label or option ID within one field), `duplicate_field_id`, `unknown_field_id`, `unknown_option_id`, `type_changed`, `min_above_max`, `invalid_name`, `empty_file` (`Content-Length: 0`, at `body`), `length_mismatch` (the body ended before or ran past `Content-Length`).
Answer detail codes (returned by Phase 6 at `answers.<field ID>`): `required`, `wrong_type`, `too_long`, `below_minimum`, `above_maximum`, `not_integer`, `invalid_date`, `unknown_option`, `duplicate_option`, `too_many_files`, `unknown_field`.

Answer rules (approved 2026-10-25):

- `validateAnswers` returns details with the full path `answers.<field ID>`, so Phase 6 passes them through unchanged.
- An answer is unanswered when it is missing, null, blank text, or an empty list; a required field then gets `required`, and an optional one is skipped. `false` and `0` are answers.
- A date answer is a `YYYY-MM-DD` string that is a real Gregorian date (year 1 or later).
- Choice answers carry option IDs, not labels.
- A file answer that is not a list, holds an ID that is not a UUID, or names the same file twice is `wrong_type`; `too_many_files` is only for more than `maxFiles`.
- Text lengths in answers count Unicode code points; labels in the form count UTF-16 units, as elsewhere in the API.
- A snapshot entry is `{field, value, chosen?}`: a deep copy of the field definition, the answer, and for choices the chosen options as `{id, label}`. Only answered fields are kept, in form order.
