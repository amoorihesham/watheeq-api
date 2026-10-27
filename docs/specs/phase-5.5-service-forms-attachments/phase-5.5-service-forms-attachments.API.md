# Phase 5.5 API: Service Forms and File Storage

The endpoints of [phase-5.5-service-forms-attachments.md](phase-5.5-service-forms-attachments.md), moved out of its section 4.2.
Section numbers and requirement IDs below refer to that spec.
This is the implemented form: an index of the endpoints.
Request and response shapes, statuses, and the errors of each endpoint are in `docs/api/openapi.json`.

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).

| Method | Path                          | Who                         | Purpose                                                                                     | Spec refs                      |
| ------ | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| GET    | `/services/:id`               | `service.view`              | (changed) The service now includes its form, `{revision, fields}`                           | R5.5.1, R5.5.2, R5.5.3         |
| PUT    | `/services/:id/form`          | `service.manage`            | Save the whole form against the revision it was based on                                    | R5.5.4, R5.5.5, R5.5.6         |
| POST   | `/files`                      | active member (Q9)          | Upload a file as raw bytes with its name in the query string; it stays pending              | R5.5.9, R5.5.10, R5.5.11       |
| POST   | `/operator/plans`             | `platform.plan.create`      | (changed) `storageLimitGb` is required on create                                            | R5.5.17                        |
| PATCH  | `/operator/plans/:planId`     | `platform.plan.update`      | (changed) `storageLimitGb` is allowed on update                                             | R5.5.17                        |
| GET    | `/subscription`               | as Phase 1                  | (changed) Adds the storage limit and `usage.storage`                                        | R5.5.18, R5.5.20, R5.5.21      |
| GET    | `/operator/tenants/:tenantId` | as Phase 1                  | (changed) Adds the storage limit and `usage.storage`                                        | R5.5.21                        |
| GET    | `/files/:id`                  | the uploader, while pending | The file's metadata                                                                         | R5.5.9                         |
| GET    | `/files/:id/content`          | the uploader, while pending | The file's bytes as a download, with the detected type                                      | R5.5.9, R5.5.13                |
| DELETE | `/files/:id`                  | the uploader, while pending | Discard the upload                                                                          | R5.5.9, R5.5.12                |

## Rules a schema does not state

- `POST /files` needs `Content-Length` (411 without it) and `Content-Type: application/octet-stream`; the file name travels in the query string, percent-encoded, so Arabic names need no special header encoding.
- `GET /files/:id` for a file that is not the caller's pending upload is 404, whoever owns it, so a file ID reveals nothing; Phase 6 adds the routes for attached files.
- `DELETE` marks the upload `discarded`, so it disappears at once and the sweep deletes its bytes and row; a discarded upload was never part of any record.
- A field in a request omits `id` for a new field or option, and every setting of its type is required (`min` and `max` may be null); a setting of another type may be sent as `null`, so a field can be sent back as it was read, and a non-null one is `unknown_field` (T25).
- A stale `baseRevision` is 409 `VERSION_CHANGED`.

Answer rules (approved 2026-10-25), used by Phase 6 at `answers.<field ID>`:

- `validateAnswers` returns details with the full path `answers.<field ID>`, so Phase 6 passes them through unchanged.
- An answer is unanswered when it is missing, null, blank text, or an empty list; a required field then gets `required`, and an optional one is skipped. `false` and `0` are answers.
- A date answer is a `YYYY-MM-DD` string that is a real Gregorian date (year 1 or later).
- Choice answers carry option IDs, not labels.
- A file answer that is not a list, holds an ID that is not a UUID, or names the same file twice is `wrong_type`; `too_many_files` is only for more than `maxFiles`.
- Text lengths in answers count Unicode code points; labels in the form count UTF-16 units, as elsewhere in the API.
- A snapshot entry is `{field, value, chosen?}`: a deep copy of the field definition, the answer, and for choices the chosen options as `{id, label}`. Only answered fields are kept, in form order.
