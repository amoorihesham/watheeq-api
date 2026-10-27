# Conventions

The rules every endpoint follows.
They are enforced by `src/http/respond.ts` (responses), `src/http/list.ts` (lists and cursors), `src/http/filters.ts` (filters), and `src/http/validate.ts` (request input).

## Success responses

Every successful response with a body is JSON with `data` at the top level.

| Case | Status | Body |
| ---- | ------ | ---- |
| One item, or a composite view | 200 | `{"data": {...}}` |
| A new resource with its own URL | 201 | `{"data": {...}}`, the created item |
| A list | 200 | `{"data": [...], "page": {...}}` |
| Nothing is left to show | 204 | none |

Nothing else sits at the top level except `page` on a list.
A bare array would leave no place for `page`, and named keys such as `{priority}` would need a different key for every endpoint.

Example: `PATCH /priorities/<urgent>` answers `{"data": {"id": "...", "name": "Urgent", "days": 2, "retired": false}}`, and `GET /subscription` answers `{"data": {"subscription": {...}, "usage": {...}}}`.

- 201 is only for a creation that has its own URL: Sara creates a priority and gets 201.
  An action on an existing resource, such as Faisal asking Khalid a question on request #42, is 200 with the request.
- 204 is for deletes, logout, password calls, resends, and marking notifications read.
  Sara deletes the Litigation section: 204 with no body.
- Every field of a response is always present.
  An empty value is `null`, never a missing key, and the variants of one shape carry the same keys.
- A write returns the resource it changed, in exactly the shape its read returns.
  Huda accepts request #42: the response's `data` equals `GET /requests/<#42>`'s `data`, so the client needs no refetch.
  A value computed when it is read, such as the elapsed time of an open request's SLA, is as of each answer, so a later read can show a later value.
- A collection inside one resource (a request's files, a workflow's stages, the org tree, a calendar's periods) is an array inside that resource and is not paged.

## Lists and cursors

Every list endpoint is paged by cursor.

```
GET /users?status=active&limit=25&cursor=eyJ2Ijox...
```

```json
{
  "data": [{ "id": "...", "userName": "Ahmed" }],
  "page": { "nextCursor": "eyJ2IjoxLCJhZnRlciI6...", "total": 128 }
}
```

| Parameter | Meaning |
| --------- | ------- |
| `limit` | Items per page: 1 to 100, default 25. May change between pages |
| `cursor` | The `nextCursor` of the previous page; left out for the first page |

- `nextCursor` is `null` on the last page, and an empty list is `{"data": [], "page": {"nextCursor": null, "total": 0}}`.
- A cursor is opaque: pass it back unchanged.
  It carries the position after the last item and a fingerprint of the list and its filters.
- A cursor used with other filters, on another list, or altered or broken is 400 `VALIDATION_FAILED` with the detail `{path: "cursor", code: "invalid_cursor"}`.
  A client restarts the list from the first page.
  Example: Faisal is on page 2 of `GET /requests?view=review_queue` and the app sends the same cursor with `view=handling`; the answer is `invalid_cursor`, so the app restarts the tab instead of missing requests.
- Each list has one fixed order, declared with its sort keys in its `.API.md`, ending with the ID as the tie-breaker.
  A page continues strictly after the last item of the previous page, so a new, removed, or tied item never causes a repeat or a skip.
  There is no client-chosen sorting.
- `total` is the number of items that match the filters, not the items left, counted in the same database snapshot as the page.
  Page 1 and page 3 of Al-Noor's users list both say 128; if Sara invites a member in between, a later page says 129.
- `limit=0` is `too_small`, `limit=101` is `too_big`, and `limit=abc` is `invalid_type`, each at `limit`.

## Filters

One rule applies to every filter of every list.

| Form | Meaning |
| ---- | ------- |
| `field=value` | Keep the items whose field has that value |
| `field=all` | No filter on that field |
| `field=none` | Keep the items where the field is empty (only where the `.API.md` says so) |
| field left out | The default documented for that list |

- `q` (text search) and `view` (a named list relative to the caller, such as `review_queue`) are the only parameters that are not field filters.
- A value the list does not accept is 400 `VALIDATION_FAILED` with `{path: <filter>, code: "invalid_value"}`.
- A parameter the list does not know is ignored.
- A filter's default is part of the list's contract: `GET /priorities` shows the 5 active priorities of Al-Noor, `?retired=all` shows all 6, and `?retired=true` shows only the retired one.
  `GET /users?unitId=none` lists the members placed directly under the organization (Sara and Lina).
- `unread=false` on `GET /notifications` returns only read notifications.

## Request methods

| Method | Use |
| ------ | --- |
| `POST /things` | Create |
| `PATCH /things/:id` | Change some fields: only the fields sent change, at least one is required (`no_fields`), and `null` clears a field |
| `PUT /things/:id/part` | Replace one whole part (a form, the priority order, a role assignment, the escalation settings) |
| `POST /things/:id/<action>` | A business action (`accept`, `retire`, `close-no-response`) |
| `DELETE /things/:id` | Remove |

Request bodies are JSON with `Content-Type: application/json` and at most 100 KB (415 `UNSUPPORTED_MEDIA_TYPE`, 413 `PAYLOAD_TOO_LARGE`).
A body field the endpoint does not accept is 400 with the detail `{path: <field>, code: "unknown_field"}`, at its full path (`admin.phone`).
Query strings and token claims are lenient.

Example: `PATCH /users/<huda>` with `{"unitId": null}` moves Huda directly under the organization, while `{}` is 400 `no_fields`.

## Value formats

| Kind | Format |
| ---- | ------ |
| ID | UUID, lower-case in responses, any case accepted in requests |
| Moment | ISO 8601 UTC with milliseconds, `2026-10-26T06:30:00.000Z` |
| Calendar day | `YYYY-MM-DD`, a day in Riyadh |
| Time of day | `HH:MM`, 24-hour, Riyadh |
| Money | An integer number of halalas, the key ending in `Halalas` (`priceHalalas: 76500` is 765.00 SAR) |
| Duration | A number with its unit in the key (`breachDays`) |
| Keys | camelCase |
| Text input | Trimmed; a blank optional text is stored as `null`; a blank required text is `too_small` |

Example: a role description of `"   "` is stored as `null`, and a priority named `"   "` is 400 `too_small` at `name`.

## Uploads and downloads

These are the only bodies that are not JSON.

- **Upload:** `POST /files?name=<name>` sends the file's raw bytes as the body, with `Content-Length` and the name percent-encoded in the query string, and answers 201 `{"data": file}`.
  Khalid's browser sends `fetch("/files?name=contract.pdf", {method: "POST", body: file})`.
  A file stays pending for 24 hours until a request attaches it.
- **Download:** a file's `/content` route answers the raw bytes as an attachment, never displayed inline.
  Example: `GET /requests/<#42>/files/<file>/content`.

The upload limits and their error codes (`FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `UPLOAD_QUOTA_REACHED`, `STORAGE_LIMIT_REACHED`, `LENGTH_REQUIRED`) are in `errors.md`.

## Caching

Tenant and operator routes send `Cache-Control: no-store`, so a client or proxy never serves an old answer.

## Request IDs

Every response has an `X-Request-Id` header, which is also the `requestId` of an error body.
A client-sent `X-Request-Id` is reused only if it matches `^[A-Za-z0-9._-]{1,64}$`; otherwise the server generates one.
A client shows this ID to the user when reporting an error.

## Health

`GET /health` follows the same rules and needs no login: 200 `{"data": {"status": "ok", "db": "up"}}`, or 503 `SERVICE_UNAVAILABLE` when the database cannot be reached.
