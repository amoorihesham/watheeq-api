# Phase 5.5 Spec: Service Forms and File Storage

| Field                  | Value                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**             | In Implementation                                                                                                                        |
| **Approved by / date** | _Amr - 25/10/2026 - 17:55 pm_                                                                                                            |
| **Depends on**         | Phase 0 (`phase-0-foundations.md`), Phase 0.5 (`phase-0.5-refactor.md`), Phase 5 (`phase-5-legal-configuration.md`)                      |
| **Related decisions**  | MVP 3.1, 3.4, 3.5, section 4, D12, D14, D15, D28, D31; Technical T2, T8, T10, T11, T14, T16, T17, T19, T20, T22, T24, T25, T35, T36, T37 |

---

## 1. Objective

Let the legal team define, per service, the **form** a requester fills in, and give the platform a safe place to **store uploaded files**.
It is needed now because Phase 6 submits requests: a submission carries the service's form answers, including required documents, and request work adds attachments.
Building both first means Phase 6 is written against a finished contract (4.3, "Contract with Phase 6") instead of reworking submission later (P5.5.1).

## 2. Scope

**In scope:**

- **Service forms:** an ordered list of fields per service, edited as a whole with a base revision (Q1, Q2).
- **Answer validation and snapshots:** the functions Phase 6 calls to check a submission's answers against the form and to store them with a copy of the field definitions (Q2).
- **File storage:** S3-compatible object storage behind a small interface, a local server in Docker for development and tests (Q4).
- **Uploads:** any active member uploads a file, which stays **pending**, visible only to its uploader, until Phase 6 attaches it or it expires (Q7, Q9).
- **Limits:** size, allowed types detected from content, pending uploads per person (Q5).
- **Storage limit per plan:** plans carry a storage limit that subscriptions copy, enforced on every upload, with usage shown on the subscription (Q10-Q12; changes Phase 1, 4.1 "Storage limit").
- **Cleanup:** expired pending uploads and abandoned uploads are deleted with their bytes (Q8).
- **Attaching:** `attachFiles`, which Phase 6 calls in its own transaction to make pending files part of a request.

**Out of scope (and where it is handled instead):**

- Submitting requests, storing answers on a request, the requester's service catalog: Phase 6.
- Which files a request has, who may download or upload on a request, and who may remove an attachment and when: Phase 6 (its A4 and A5).
  Removal itself deletes the file (owner decision, 2026-10-25), through `discardFiles` (4.3).
- Virus scanning: deferred hardening (Q6).
- A retention term on plans, and deleting a tenant's data after its subscription ends: revisited in a future scope (owner decision, 2026-10-25, P5.5.7).
- Warning Tenant Admins before the storage limit is reached: Phase 7 notifications.
- Previews and thumbnails, opening files in the browser, versioning a document: later.
- Conditional fields, field groups, calculated fields, reusable field libraries across services: later.
- Translated labels: labels are one text in the tenant's own language, as for service names.

## 3. Requirements

Example tenant: **Al-Noor**, with the people and configuration of the Phase 5 spec, section 3.
Huda (Head of Legal) holds `service.manage`; Khalid (Procurement) and Majed (Finance manager) hold no legal permissions.

Huda's form for "Vendor contract review":

| #   | Label                    | Type          | Settings                | Required |
| --- | ------------------------ | ------------- | ----------------------- | -------- |
| 1   | Counterparty name        | short text    |                         | yes      |
| 2   | Contract value (SAR)     | number        | min 0                   | yes      |
| 3   | Contract type            | single choice | Supply, Services, Lease | yes      |
| 4   | Expected start date      | date          |                         | no       |
| 5   | Needs Arabic translation | yes/no        |                         | no       |
| 6   | Draft contract           | file          | up to 3 files           | yes      |
| 7   | Notes                    | long text     |                         | no       |

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                         | Example                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5.5.1  | A service has a form: an ordered list of fields, with no limit on their number (Q1); the 100 KB request-body limit (`jsonBody`) is the practical bound. Existing and new services start with an empty form.                                                                                                                                                                                         | _"Vendor contract review" has no fields until Huda saves the form above._                                                                                                                      |
| R5.5.2  | A field has a label (1-200 characters, unique within the form ignoring case), optional help text (up to 500 characters), a required flag, and a type with its settings (R5.5.3).                                                                                                                                                                                                                    | _A second field labelled "notes": 400 `duplicate_label`._                                                                                                                                      |
| R5.5.3  | Field types: **short text** (up to 500 characters), **long text** (up to 10,000), **number** (optional minimum and maximum, optionally whole numbers only), **date** (a Gregorian calendar date), **single choice** and **multiple choice** (1-50 options, each with a label of 1-200 characters, unique within the field ignoring case), **yes/no**, **file** (at most 1-10 files, set per field). | _"Contract type" with options Supply, Services, Lease, Supply: 400 `duplicate_option`._                                                                                                        |
| R5.5.4  | The form is saved as a whole and names the revision it was based on. A save that changes the form increments the revision; a save based on an older revision is refused. A save that changes nothing returns 200 with no audit entry.                                                                                                                                                               | _Huda and Ahmed both open revision 3; Huda saves (revision 4); Ahmed saves: 409 `SERVICE_FORM_CHANGED`._                                                                                       |
| R5.5.5  | Fields and options keep their IDs across saves: the client sends the ID of each existing field and option, and the server assigns IDs to new ones. An ID not in the current form is refused. A field's type never changes; a different type is a new field.                                                                                                                                         | _Huda changes "Expected start date" from date to short text: 400 `type_changed`._                                                                                                              |
| R5.5.6  | A retired service's form cannot be edited.                                                                                                                                                                                                                                                                                                                                                          | _409 `RESOURCE_RETIRED`._                                                                                                                                                                      |
| R5.5.7  | Answers are checked against the form (for Phase 6): every required field answered, every answer of its field's type and within its settings, no answer for a field the form does not have.                                                                                                                                                                                                          | _Khalid leaves "Contract value" empty: `required` at `answers.<field ID>`; he sends -5: `below_minimum`._                                                                                      |
| R5.5.8  | A stored answer carries a copy of its field's definition at the time of answering, so later form edits never change what a submitted request shows (Q2).                                                                                                                                                                                                                                            | _Huda renames "Contract type" to "Agreement type" on 11-10; #42, submitted on 11-01, still shows "Contract type: Supply"._                                                                     |
| R5.5.9  | Any active member of the tenant may upload a file. An upload is **pending**: only its uploader can read or discard it, until Phase 6 attaches it or it expires 24 hours after upload (Q7, Q9).                                                                                                                                                                                                      | _Khalid uploads "draft-contract.pdf" before submitting #42; Faisal cannot see it; Majed, a stage assignee with no legal permissions, can upload too (Phase 6 decides where he may attach it)._ |
| R5.5.10 | A file is at most 25 MB. Its type is detected from its content, must be allowed, and must match the file name's extension (Q5).                                                                                                                                                                                                                                                                     | _A 30 MB scan: 413 `FILE_TOO_LARGE`. An executable renamed "contract.pdf": 415 `FILE_TYPE_NOT_ALLOWED`._                                                                                       |
| R5.5.11 | A person has at most 20 pending uploads at a time.                                                                                                                                                                                                                                                                                                                                                  | _Khalid's 21st pending upload: 409 `UPLOAD_QUOTA_REACHED`; discarding one frees a place._                                                                                                      |
| R5.5.12 | Expired pending uploads, and uploads that never finished, are deleted together with their stored bytes. An expired upload cannot be attached even before it is deleted.                                                                                                                                                                                                                             | _Khalid uploads at 09:00 on 11-01 and submits at 09:30 on 11-02: the file is refused as `file_expired`; he uploads it again._                                                                  |
| R5.5.13 | Files are only ever served as downloads, with the detected type, never displayed inside the application's pages.                                                                                                                                                                                                                                                                                    | _Downloading "draft-contract.pdf" saves it; the browser does not render it in the API's origin._                                                                                               |
| R5.5.14 | Form saves, uploads, and discards are refused while the subscription is Read-only, and allowed in Active and Grace.                                                                                                                                                                                                                                                                                 | _In Grace, Faisal can still upload to an in-progress request (Phase 6); in Read-only: 403 `SUBSCRIPTION_READ_ONLY`._                                                                           |
| R5.5.15 | Every form save that changes the form is audited in the same transaction. Uploads and discards are not audited; attaching is, by Phase 6.                                                                                                                                                                                                                                                           | _`service.form_updated` with the revision and the fields before and after._                                                                                                                    |
| R5.5.16 | Every endpoint reads and writes only the caller's tenant, and a file's bytes are stored under its tenant.                                                                                                                                                                                                                                                                                           | _An Al-Rashid user requesting an Al-Noor file ID: 404._                                                                                                                                        |
| R5.5.17 | A plan has a storage limit, a whole number of GB (1-100,000), required. A subscription copies it at assignment, like the user limit (D14).                                                                                                                                                                                                                                                          | _Sami (operator) creates "Business" with 50 users and 20 GB; Al-Noor's subscription copies 20 GB; raising the plan to 30 GB later does not change Al-Noor's 20 GB._                            |
| R5.5.18 | A tenant's storage usage is every stored byte: pending uploads, attached files, and discarded files until the sweep has deleted them. A removed attachment is deleted, so it stops counting (Q14). An upload that would take usage past the limit is refused; nothing else is affected (Q10, Q12).                                                                                                  | _Al-Noor uses 19.99 GB of 20 GB; Khalid's 25 MB upload: 409 `STORAGE_LIMIT_REACHED`; reviewing, accepting, and stage work go on._                                                              |
| R5.5.19 | The limit holds under concurrent uploads.                                                                                                                                                                                                                                                                                                                                                           | _40 MB left; Khalid and Faisal each start 25 MB at the same moment: one succeeds, the other gets 409 `STORAGE_LIMIT_REACHED`._                                                                 |
| R5.5.20 | A subscription moved to a smaller limit than the current usage keeps every file; uploads are refused until usage is under the limit (as D15 for users).                                                                                                                                                                                                                                             | _Al-Noor uses 18 GB and moves to a 10 GB plan: files stay; uploads refused; `overLimit` shown._                                                                                                |
| R5.5.21 | Tenant Admins see storage usage and the limit in `GET /subscription`; the operator sees them in the tenant view.                                                                                                                                                                                                                                                                                    | _`usage.storage: {usedBytes: 19990000000, limitBytes: 21474836480, overLimit: false}`._                                                                                                        |

## 4. Design

### 4.1 Data model

#### Service forms

**`services`** (changed): two new columns.

| Column          | Type      | Notes                                                                               |
| --------------- | --------- | ----------------------------------------------------------------------------------- |
| `form`          | `jsonb`   | Not null, default `[]`; check `jsonb_typeof(form) = 'array'`. The fields, in order. |
| `form_revision` | `integer` | Not null, default 0; incremented by every save that changes the form.               |

A field in `form`:

```ts
{
  id: string,            // UUID, stable across saves
  label: string,
  helpText: string | null,
  required: boolean,
  type: "short_text" | "long_text" | "number" | "date" | "single_choice" | "multiple_choice" | "yes_no" | "file",
  // per type:
  min?: number | null, max?: number | null, integer?: boolean,     // number
  options?: { id: string, label: string }[],                        // single_choice, multiple_choice
  maxFiles?: number,                                                // file, 1-10
}
```

Why a `jsonb` column and not field rows (P5.5.2): nothing outside the service refers to a field (answers carry their own copy, Q2), and the form is always read and written as a whole, so rows would add two tables (fields and options) and their ordering with no reference to protect.
Workflow stages are rows because request stages reference them (Phase 5 Q3); fields are not referenced.
The structure is enforced by one zod schema at the trust boundary (T25), and the database only guarantees it is an array.

Why stable IDs: an answer stores its field's ID with the copy of the definition, so a later report can follow "Contract value" across form revisions even after a rename.
That is also why a field's type cannot change: the same ID would then hold a date in one request and text in another.

#### Files

**`files`** (new, tenant data):

| Column         | Type          | Notes                                                                                                                            |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid` PK     | Also the storage key's last part.                                                                                                |
| `tenant_id`    | `uuid`        | FK to `tenants`, not null.                                                                                                       |
| `uploaded_by`  | `uuid`        | FK to `users`, not null.                                                                                                         |
| `state`        | `file_states` | Enum `uploading`, `pending`, `attached`, `discarded` (waiting for the sweep to delete its bytes and row).                        |
| `name`         | `text`        | The cleaned file name (4.3), 1-255 characters.                                                                                   |
| `content_type` | `text`        | Detected from the content; null while `uploading`.                                                                               |
| `size_bytes`   | `integer`     | Not null: the size declared by `Content-Length`, reserved before the bytes arrive (4.3), and checked against the bytes received. |
| `sha256`       | `text`        | Hex digest computed while streaming; null while `uploading`. Evidence that a legal document is unchanged.                        |
| `created_at`   | `timestamptz` | The expiry of a pending upload is `created_at` plus 24 hours, computed, not stored.                                              |
| `attached_at`  | `timestamptz` | Set by `attachFiles`.                                                                                                            |

Checks: `(state = 'attached') = (attached_at is not null)`; `state = 'uploading' or (content_type and sha256 not null)`; `size_bytes between 1 and 26214400`.
Unique `(tenant_id, id)` is the target of Phase 6's composite foreign keys.
Index `(state, created_at) where state <> 'attached'` serves the cleanup; index `(uploaded_by) where state <> 'attached'` serves the quota; index `(tenant_id)` serves the storage usage sum.
A removed attachment is deleted (Q14): Phase 6 marks it `discarded` in its own transaction, and the sweep deletes its bytes and then its row.
The file's name, size, and SHA-256 survive in Phase 6's audit entry, so the history still shows what was removed, by whom, and why.

The bytes live in the object store under the key `<tenant_id>/<file_id>`; the key is derived, never stored, and never contains the user's file name.

Why a row before the bytes (P5.5.4): every stored object then has a row, so the database is the one list of what exists and the cleanup never has to scan the bucket.
An upload that crashes halfway leaves an `uploading` row, which the cleanup finds and removes with whatever bytes reached the store.

#### Storage limit (changes Phase 1)

**`plans.storage_limit_gb`** and **`subscriptions.storage_limit_gb`** (new): `integer`, not null, check between 1 and 100,000.
The subscription copies the plan's value at assignment and on a plan change, exactly as `user_limit` (Phase 1 spec, 4.1).
One GB is 1,073,741,824 bytes (2^30), the unit object-storage providers bill in; responses give bytes, so clients choose how to display them.

Usage is `sum(size_bytes)` over the tenant's `files` rows, computed when needed and never stored as a counter, so it can never drift from the files that exist.
An `uploading` row counts with its declared size, which is what makes the reservation in 4.3 work.

#### Migrations

Generated `0013_service_forms` (step 5.5.1) and `0014_files` (step 5.5.2), which also adds the two `storage_limit_gb` columns.
The defaults give every existing service an empty form at revision 0; existing plans and subscriptions get the storage limit chosen in Q13.

#### Audit actions

| Action                 | Resource | `details`                                     |
| ---------------------- | -------- | --------------------------------------------- |
| `service.form_updated` | service  | `{revision, before, after}` (the field lists) |

### 4.2 API

Tenant routes run `authenticate()`, `requireRole('user')`, and the subscription guard (T16).

| Method      | Path                                         | Permission                                               | Request                                                                               | Responses                                                                                                                                                                          |
| ----------- | -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET         | `/services/:id`                              | `service.view`                                           |                                                                                       | (changed) the service now includes `form: {revision, fields}`                                                                                                                      |
| PUT         | `/services/:id/form`                         | `service.manage`                                         | `{baseRevision, fields:[field]}`                                                      | 200 `{service}`; 400; 404; 409 `SERVICE_FORM_CHANGED`, `RESOURCE_RETIRED`                                                                                                          |
| POST        | `/files?name=<name>`                         | active member (Q9)                                       | the file's bytes, `Content-Type: application/octet-stream`, `Content-Length` required | 201 `{file}`; 400 `invalid_name`, `length_mismatch`; 409 `UPLOAD_QUOTA_REACHED`, `STORAGE_LIMIT_REACHED`; 411 `LENGTH_REQUIRED`; 413 `FILE_TOO_LARGE`; 415 `FILE_TYPE_NOT_ALLOWED` |
| POST, PATCH | `/operator/plans`, `/operator/plans/:planId` | operator: `platform.plan.create`, `platform.plan.update` | (changed) `storageLimitGb` required on create, allowed on update                      | as Phase 1                                                                                                                                                                         |
| GET         | `/subscription`, the operator tenant view    | as Phase 1                                               |                                                                                       | (changed) `subscription.storageLimitGb`; `usage.storage: {usedBytes, limitBytes, overLimit}`                                                                                       |
| GET         | `/files/:id`                                 | the uploader, while pending                              |                                                                                       | 200 `{file}`; 404                                                                                                                                                                  |
| GET         | `/files/:id/content`                         | the uploader, while pending                              |                                                                                       | 200 the bytes as a download; 404                                                                                                                                                   |
| DELETE      | `/files/:id`                                 | the uploader, while pending                              |                                                                                       | 204; 404                                                                                                                                                                           |

Shapes:

- **Field (request):** as in 4.1, with `id` omitted for a new field or option.
  Settings that do not belong to the type are `unknown_field` (T25); every setting of the type is required (`min` and `max` may be null).
- **File:** `{id, name, contentType, size, sha256, expiresAt}`.

`GET /files/:id` for a file that is not the caller's pending upload is 404, whoever owns it, so a file ID reveals nothing; Phase 6 adds the routes for attached files.
`DELETE` marks the upload `discarded`, so it disappears at once and the sweep deletes its bytes and row; a discarded upload was never part of any record.
The file name travels in the query string, percent-encoded, so Arabic names need no special header encoding.

#### New error codes

| HTTP | Code                    | When                                                                      |
| ---- | ----------------------- | ------------------------------------------------------------------------- |
| 409  | `SERVICE_FORM_CHANGED`  | `baseRevision` is not the current revision.                               |
| 409  | `UPLOAD_QUOTA_REACHED`  | The uploader already has 20 pending uploads.                              |
| 409  | `STORAGE_LIMIT_REACHED` | Usage plus the declared size would pass the subscription's storage limit. |
| 411  | `LENGTH_REQUIRED`       | An upload without `Content-Length` (for example a chunked body).          |
| 413  | `FILE_TOO_LARGE`        | `Content-Length` over 25 MB.                                              |
| 415  | `FILE_TYPE_NOT_ALLOWED` | The detected type is not allowed, or does not match the extension.        |

Validation detail codes: `duplicate_label`, `duplicate_option`, `duplicate_field_id`, `unknown_field_id`, `unknown_option_id`, `type_changed`, `min_above_max`, `invalid_name`, `length_mismatch` (the body ended before or ran past `Content-Length`).
Answer detail codes (returned by Phase 6 at `answers.<field ID>`): `required`, `wrong_type`, `too_long`, `below_minimum`, `above_maximum`, `not_integer`, `invalid_date`, `unknown_option`, `duplicate_option`, `too_many_files`, `unknown_field`.

### 4.3 Key flows

#### Saving a form

In one transaction:

1. Lock the service row (`FOR UPDATE`); 404 if absent, 409 `RESOURCE_RETIRED` if retired, 409 `SERVICE_FORM_CHANGED` if `baseRevision` is not current.
2. Check IDs against the current form: a sent ID must exist (`unknown_field_id`, `unknown_option_id`) and keep its field's type (`type_changed`); assign new IDs.
3. If the result equals the current form: return 200, no audit.
4. Otherwise store it, increment `form_revision`, audit `service.form_updated`.

Removing a field is allowed: submitted requests keep their copies (Q2), and the ID is never reused.

#### Uploading

1. Check the subscription (T16), the caller's active membership, the name (cleaned: path parts and control characters removed, Unicode normalized to NFC, 1-255 characters, an extension required), and `Content-Length` (411 if absent, 413 over 25 MB).
2. In a short transaction under a per-tenant advisory lock keyed `uploads:<tenant_id>`: count the caller's `uploading` and `pending` rows (409 `UPLOAD_QUOTA_REACHED` at 20); sum the tenant's `size_bytes` and refuse if it plus `Content-Length` passes the limit (409 `STORAGE_LIMIT_REACHED`); insert the row as `uploading` with the declared size; commit.
   The lock makes the second of two concurrent uploads wait and then count the first one's reserved size, as the seat lock does for users (T17).
   One lock per tenant serves both checks; it is held only for this short transaction, never while bytes stream.
3. Stream the body to the store, counting bytes (abort with `length_mismatch` if they differ from `Content-Length`), computing SHA-256, and detecting the type from the first bytes.
4. On success: set `state = 'pending'` with the detected type and digest; 201.
5. On any failure (too large, refused type, client disconnect, store error): delete the bytes and the row, best effort, and answer the error.
   If the process dies instead, the cleanup finds the `uploading` row.

Allowed types (Q5): PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), PNG, JPEG, and plain text (`.txt`, valid UTF-8 with no NUL byte).
Detection uses the `file-type` package for binary formats; plain text has no signature and is accepted only with the `.txt` extension after the UTF-8 check.
Whether `file-type` tells `.docx`, `.xlsx`, and `.pptx` apart while streaming, without buffering the whole file, is verified at the start of step 5.5.2 (principle 12); if it cannot, the upload is first written to the store and the type is checked by reading the stored object, deleting it on refusal.

The global JSON-only body rule (`jsonBody`) does not apply to `POST /files`, which accepts `application/octet-stream` only (415 `UNSUPPORTED_MEDIA_TYPE` otherwise).

Why the raw body and not `multipart/form-data` (P5.5.3): the client is a JavaScript web app (`fetch(url, {body: file})`), one file per request needs no multipart framing, and no parser dependency is added.

#### Cleanup

`sweepFiles(db, store)` deletes the files nobody needs: `discarded` rows, `pending` rows older than 24 hours, and `uploading` rows older than 1 hour (an upload that died midway) (Q8).

**When it runs.** `main.ts` starts it once the server listens, then schedules each next run 15 minutes after the previous one finishes (a `setTimeout` chain, not `setInterval`), so one instance never runs two sweeps at once however long a sweep takes.
Tests do not start the timer; they call `sweepFiles` directly.

**One run.** A run works in batches, each in its own short transaction:

1. Select up to 100 matching rows `FOR UPDATE SKIP LOCKED`.
2. Delete their bytes with one `DeleteObjects` call to the store (deleting a key that is already gone succeeds, so a retry is harmless).
3. Delete the rows whose bytes were deleted; commit.

The run continues with the next batch until a batch finds fewer than 100 rows, or 2 minutes have passed (the rest waits for the next run), so a backlog after downtime drains without one run holding the process for long.

**Several instances.** `SKIP LOCKED` makes each instance take rows no other instance holds, so two API servers split the work instead of deleting the same file twice or waiting on each other.

**Races with requests.** Locking re-checks a row's state: a file that Phase 6 attaches while a sweep runs is either locked by the attach first (the sweep skips it) or by the sweep first (the attach then finds no row, `unknown_file`).
`attachFiles` also checks the 24-hour age itself, so a file is never attached late just because the sweep has not run yet.

**Failures.** If the store is unreachable, the batch's transaction rolls back and the rows stay for the next run: no row disappears while its bytes remain (P5.5.4).
A failed run is logged as an error and never crashes the process.
On shutdown the timer is cleared; a batch cut off midway rolls back, and the next run repeats it.

**Observability.** Each run logs the number of files deleted by kind (discarded, expired, abandoned); a warning is logged when a matching row is more than 1 hour past due, which means sweeps are failing.

Usage (R5.5.18) still counts a discarded file until its run, at most about 15 minutes.

#### Attaching (for Phase 6)

`attachFiles(tx, tenantId, userId, fileIds)` locks the rows `FOR UPDATE` and requires each to be in the tenant, uploaded by `userId`, `pending`, and less than 24 hours old; it sets `attached` and `attached_at`, and returns the files.
Each refusal names its index: `unknown_file` (absent, another tenant's, or another person's, so nothing is revealed), `file_expired`, `file_attached`.

`discardFiles(tx, tenantId, fileIds)` locks the rows `FOR UPDATE` and marks them `discarded`; Phase 6 deletes its link rows to them in the same transaction, since the sweep later deletes the file rows.

A sweep and an attach on the same row: whichever locks first wins; the sweep re-checks the row's state and age after locking, and an attach after the sweep finds no row (`unknown_file`).

#### Contract with Phase 6

These rules are decided here and implemented in Phase 6:

- At submission, the answers are checked with `validateAnswers(form, answers)` and stored with `snapshotAnswers(form, answers)`: each answer with its field's ID, label, type, settings, and, for choices, the chosen options' labels (Q2).
- A file field's answer is a list of the requester's pending file IDs; submission attaches them with `attachFiles` in the submission's transaction.
- Removing an attachment calls `discardFiles` and deletes the link row in the same transaction, with an audit entry holding the file's name, size, and SHA-256 (Q14).
- Free attachments (Q3) use the same `attachFiles`; Phase 6 adds the tables linking files to requests, information-request replies, and stages, with composite foreign keys to `files (tenant_id, id)`.
- Phase 6 serves attached files, with the same download headers (4.3 Uploading, section 6), to whoever may view the request.
- Requesters read a service's form through Phase 6's requester-facing catalog, under `request.submit`, not through `service.view`.

### 4.4 Module structure

```
src/
  storage/                            new: FileStoreType interface, the S3 implementation, settings from config
  db/schema/services.ts               (changed) form, form_revision
  db/schema/files.ts                  new: files, file_states enum
  http/errors.ts                      (changed) new codes
  config/config.ts                    (changed) STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_FORCE_PATH_STYLE
  app.ts                              (changed) /files mounted outside the JSON-only body rule
  main.ts                             (changed) starts the 15-minute sweep
  modules/
    services/                         (changed) PUT /services/:id/form; shared/answers.ts: validateAnswers, snapshotAnswers
    platform/plans/                   (changed) storageLimitGb
    platform/tenants/                 (changed) copies storage_limit_gb with user_limit; storage usage in the tenant view
    subscriptions/                    (changed) storage usage in GET /subscription
    files/                            new: routes, controller, service, repository, config, schemas, types
      index.ts                        attachFiles, discardFiles, and sweepFiles for other modules
docker-compose.yml                    (changed) the local S3-compatible server and a one-shot bucket creation
db/migrations/0013_service_forms.sql, 0014_files.sql
```

`FileStoreType` (`put`, `get`, `delete`) follows `EmailSenderType` (T19): modules depend on the interface, and choosing the KSA provider is a configuration change.
New dependencies: `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` (streaming uploads to any S3-compatible store), and `file-type` (content detection).

## 5. Edge Cases and Failure Behavior

| Scenario                                                              | Expected behavior                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Huda and Ahmed save the form from the same revision.                  | The row lock serializes them; the second gets 409 `SERVICE_FORM_CHANGED` and reloads.                                                        |
| Huda removes "Needs Arabic translation" while #42 is in progress.     | #42 keeps its answer and its copy of the field (Q2); new submissions do not show it.                                                         |
| Huda sends a field ID from another service's form.                    | 400 `unknown_field_id`: IDs are checked against this service's current form.                                                                 |
| A number field with `min` 100 and `max` 10.                           | 400 `min_above_max`.                                                                                                                         |
| Khalid uploads two files at once while holding 19 pending.            | The tenant upload lock serializes the count; one succeeds, the other gets 409 `UPLOAD_QUOTA_REACHED`.                                        |
| Al-Noor has 40 MB left; Khalid and Faisal each start a 25 MB upload.  | The lock serializes the reservations; the second sees 15 MB left and gets 409 `STORAGE_LIMIT_REACHED` before sending any bytes to the store. |
| The upload has no `Content-Length` (chunked).                         | 411 `LENGTH_REQUIRED`: without a declared size the storage limit cannot be checked before the bytes arrive.                                  |
| `Content-Length` says 1 MB but the client sends 30 MB.                | Counting stops at 1 MB plus one byte: `length_mismatch`; the bytes and the row are deleted, so the reservation cannot be cheated.            |
| Al-Noor is moved from a 20 GB to a 10 GB plan while using 18 GB.      | Nothing is deleted; uploads get `STORAGE_LIMIT_REACHED`; `usage.storage.overLimit` is true until usage falls under 10 GB.                    |
| Khalid's pending 25 MB upload expires.                                | The sweep deletes it, and its 25 MB no longer counts toward usage.                                                                           |
| The client disconnects at 60%.                                        | The partial bytes and the row are deleted; if the process dies first, the sweep removes them after an hour.                                  |
| The object store is down.                                             | 500 `INTERNAL`, logged with the file ID; the row is deleted; nothing pending is left.                                                        |
| A `.pdf` whose content is a ZIP, or `.exe` content named `.docx`.     | 415 `FILE_TYPE_NOT_ALLOWED`.                                                                                                                 |
| A file named `../../etc/passwd.txt` or with control characters.       | The name is cleaned to `passwd.txt`; the storage key never uses the name.                                                                    |
| An Arabic name, `عقد التوريد.pdf`.                                    | Stored and returned as is; downloads use `filename*=UTF-8''...`.                                                                             |
| Phase 6 attaches a file at 23:59:59 of its life while the sweep runs. | Row locks decide; either the attach succeeds and the sweep skips the row, or the sweep deletes it and the attach gets `unknown_file`.        |
| Khalid tries to attach Nora's pending upload by ID.                   | `unknown_file`, the same as an ID that does not exist.                                                                                       |
| The tenant becomes Read-only with pending uploads.                    | Uploads and discards are refused; the pending uploads expire and are swept as usual.                                                         |
| A deactivated user's pending uploads.                                 | They can no longer be attached (`attachFiles` takes the acting user); they expire and are swept.                                             |

## 6. Security and Authorization

- **Trust boundaries:** form bodies are zod strict objects (T25); file names are cleaned and never used as storage keys; the type comes from the content, not the name or the client's header.
- **Tenant isolation:** rows carry `tenant_id` and every query filters by it (T2); keys are prefixed by tenant; Phase 6 links files with composite foreign keys (T21).
- **Authorization:** form edits need `service.manage`.
  Uploading needs only an active membership (Q9): stage assignees such as Majed hold no permissions yet must attach documents, as D31 lets them act on stages.
  This is a recorded exception to T24, limited by the quota, the 24-hour life, and the rule that a pending file is visible only to its uploader.
- **Serving files:** always `Content-Disposition: attachment` with the detected type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `Cache-Control: no-store`, so an uploaded HTML or SVG can never run in the application's origin (and neither is an allowed type).
- **Storage:** a private bucket in Saudi Arabia (data residency), encrypted at rest by the provider; credentials only in configuration.
- **Logs:** file IDs only, never file names, which may contain personal data.
- **Not scanned for malware** in the MVP (Q6); the allow-list, download-only serving, and no legacy Office formats (which can carry macros) reduce the exposure until scanning is added.
- **Audit:** form changes in the same transaction (T8); attaching is audited by Phase 6.

## 7. Implementation Steps

| Step                | Objective                                                                                       | Delivers                                                                                                                                                                                                                                                                  | Acceptance criteria                                                                                                                    | Verification                                                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.5.1 Service forms | Each service has a form; answers can be checked and copied.                                     | Migration `0013`, `PUT /services/:id/form`, `form` in the service response, `validateAnswers`, `snapshotAnswers`, audit.                                                                                                                                                  | R5.5.1-R5.5.8, R5.5.14-R5.5.16 for forms: Huda's form in section 3 saves as written; every answer code is produced by a matching case. | Integration tests for the endpoint; unit tests for both functions over every type; mutation checks: removing the row lock or the type-change check fails a test.                                                                                                                                      |
| 5.5.2 File storage  | Files can be uploaded safely within the plan's storage, held pending, attached, and cleaned up. | Migration `0014`, the storage interface and S3 implementation, the local server in Docker Compose and in Testcontainers, the `/files` endpoints, limits, type detection, the sweep, `attachFiles`, the storage limit on plans and subscriptions with usage in both views. | R5.5.9-R5.5.21: every example in section 3 and every row of section 5 for files; bytes and rows never disagree after a failure.        | Integration tests against a real S3-compatible server; mutation checks: removing the upload lock, the reservation of the declared size, the expiry check in `attachFiles`, or the sweep's re-check fails a test; an end-to-end upload, download, discard, and limit refusal against a running server. |

The two steps do not depend on each other and are built by the two sub-agents in parallel.
`0013` belongs to step 5.5.1; step 5.5.2 generates `0014` after merging 5.5.1's migration, so the Drizzle journal stays linear.

## 8. Test Plan

Integration tests against real PostgreSQL and a real S3-compatible server with Al-Noor and Al-Rashid.

| Requirement      | Test                                                                                                                                                   | Step  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| R5.5.1-R5.5.6    | Form saves: every type and setting, labels and options, ID rules, revisions, no-op saves, retired services.                                            | 5.5.1 |
| R5.5.7, R5.5.8   | `validateAnswers` and `snapshotAnswers` for every type, required and optional, every answer code.                                                      | 5.5.1 |
| R5.5.9, R5.5.11  | Upload, read, discard by the uploader; 404 for anyone else; the quota and its race.                                                                    | 5.5.2 |
| R5.5.10, R5.5.13 | Size by header and by stream; each allowed type; disguised and refused types; download headers.                                                        | 5.5.2 |
| R5.5.12          | Sweep of expired and abandoned uploads; `attachFiles` refusals; the sweep-versus-attach race.                                                          | 5.5.2 |
| R5.5.14-R5.5.16  | Read-only, audit rows, Al-Rashid IDs and keys.                                                                                                         | both  |
| R5.5.17-R5.5.21  | Plans and subscriptions carry and copy the limit; usage sums every state; the concurrent-reservation race; downgrade over the limit; both usage views. | 5.5.2 |

## 9. Open Questions

Q1-Q6 are the round 2 questions F1-F3 and A1-A3 of the Phase 6 pre-spec discussion, moved here when the phase was split on 2026-10-25.

| #   | Question                                                                                                                                                  | Options                                                                                                                                                                                                                                                                                                                                                                                                     | Resolution                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Which field types does a form offer?                                                                                                                      | (a) short text, long text, number, date, single choice, multiple choice, yes/no, file; label, help text, required flag; at most 50 fields (the owner removed the field limit). (b) Fewer: text, number, date, single choice.                                                                                                                                                                                | **Resolved 2026-10-25: (a)**, the eight types with label, help text, and required flag, and no limit on the number of fields (P5.5.2).                                                                               |
| Q2  | What happens to submitted requests when Huda edits a form? Example: she adds a required "Contract value" on 11-10; #42 was submitted on 11-01 without it. | (a) each answer is stored with a copy of its field's definition, as the priority is copied; no form versions. (b) Version forms like workflows (T35); worth it only if something will reference individual fields.                                                                                                                                                                                          | **Resolved 2026-10-25: (a)**, each answer is stored with a copy of its field's definition; forms are not versioned (P5.5.2).                                                                                         |
| Q3  | Are files a field type, free attachments, or both?                                                                                                        | (a) both: file fields for documents the form requires, free attachments for documents added during the work (a reply with a PDF, the final opinion). (b) File fields only. (c) Free attachments only.                                                                                                                                                                                                       | **Resolved 2026-10-25: (a)**, both: file fields on the form and free attachments during the work (Phase 6 contract).                                                                                                 |
| Q4  | Where do the bytes live?                                                                                                                                  | (a) S3-compatible object storage in Saudi Arabia; a local S3-compatible server in Docker for development and tests. MinIO changed how it distributes its community edition in 2025, so the local server (MinIO, SeaweedFS, or Garage) is chosen at the start of step 5.5.2 for being maintained and pinnable. (b) PostgreSQL: no new infrastructure, but the database and its backups grow with every file. | **Resolved 2026-10-25: (a)**, S3-compatible object storage in Saudi Arabia, with a local S3-compatible server chosen at the start of step 5.5.2 (P5.5.5).                                                            |
| Q5  | Which limits?                                                                                                                                             | (a) 25 MB per file, 20 pending uploads per person, the allow-list in 4.3 (no legacy `.doc`, `.xls`, `.ppt`, which can carry macros and cannot be told apart by content); Phase 6 caps a request at 50 files. (b) Other numbers or types.                                                                                                                                                                    | **Resolved 2026-10-25: (a)**, 25 MB per file, 20 pending (unattached) uploads per person, the allow-list in 4.3 without legacy Office formats, 50 files per request in Phase 6.                                      |
| Q6  | Are uploads scanned for viruses?                                                                                                                          | (a) deferred hardening, triggered "before production"; until then download-only serving and the allow-list. (b) Scan now with ClamAV, another service to run.                                                                                                                                                                                                                                               | **Resolved 2026-10-25: (a)**, virus scanning is deferred hardening with the trigger "before production"; files are served only as downloads.                                                                         |
| Q7  | How long does a pending upload live? Example: Khalid uploads his draft at 09:00 and submits after lunch, or the next day.                                 | (a) 24 hours. (b) 1 hour: less unused storage, but a requester who pauses must upload again. (c) 7 days.                                                                                                                                                                                                                                                                                                    | **Resolved 2026-10-25: (a)**, a pending upload lives 24 hours.                                                                                                                                                       |
| Q8  | What removes expired uploads? Phase 7 decides the background job runner.                                                                                  | (a) an in-process sweep every 15 minutes in each API instance, safe to run in parallel (`SKIP LOCKED`); Phase 7 may move it to its runner. (b) Decide Phase 7's job runner now. (c) A bucket lifecycle rule: not every S3-compatible provider supports one, and rows would still need removing.                                                                                                             | **Resolved 2026-10-25: (a)**, an in-process sweep in each API instance, as described in 4.3 "Cleanup"; Phase 7 may move it to its job runner (P5.5.9).                                                               |
| Q9  | Who may upload?                                                                                                                                           | (a) any active member, an exception to T24 like D31, limited by the quota and the 24-hour life; Phase 6 decides where each person may attach. (b) Require `request.submit`: Majed, a stage assignee with no permissions, could not attach a signed approval.                                                                                                                                                | **Resolved 2026-10-25: (a)**, any active member may upload, a recorded exception to T24, bounded by the quota, the 24-hour life, and the storage limit.                                                              |
| Q10 | What counts toward a plan's storage limit?                                                                                                                | (a) Every stored byte: pending uploads, attached files, and files waiting to be deleted. (b) Attached files only.                                                                                                                                                                                                                                                                                           | **Resolved 2026-10-25: (a)**, usage is every stored byte, whatever the file's state (P5.5.6).                                                                                                                        |
| Q11 | How is the storage limit set?                                                                                                                             | (a) A whole number of GB, required on every plan, no "unlimited". (b) Allow "unlimited".                                                                                                                                                                                                                                                                                                                    | **Resolved 2026-10-25: (a)**, a required whole number of GB on every plan; a large customer gets a large number (P5.5.6).                                                                                            |
| Q12 | What happens when the limit is reached?                                                                                                                   | (a) Uploads are refused, everything else keeps working, usage shown in `GET /subscription`. (b) Something stricter.                                                                                                                                                                                                                                                                                         | **Resolved 2026-10-25: (a)**, only uploads are refused; nothing is deleted, as D15 for users (P5.5.6).                                                                                                               |
| Q13 | What storage limit do existing plans and subscriptions get from the migration? Only local and test data exists today.                                     | (a) 10 GB, which the operator edits afterwards. (b) Another value.                                                                                                                                                                                                                                                                                                                                          | **Resolved 2026-10-25: (a)**, the migration gives existing plans and subscriptions 10 GB, which the operator edits afterwards.                                                                                       |
| Q14 | When an attachment is removed (Phase 6's A4), are its bytes kept or deleted?                                                                              | (a) Kept and hidden, still counting toward the limit. (b) Deleted, with the file's details kept in the audit.                                                                                                                                                                                                                                                                                               | **Resolved 2026-10-25: (b)**, a removed attachment is deleted, so customers do not pay for files nobody uses; the audit keeps its name, size, and SHA-256 (P5.5.8).                                                  |
| Q15 | How does a customer get more than the largest plan's limits? Example: Al-Noor needs 500 GB while Enterprise has 100 GB.                                   | (a) A custom plan for that customer, with its own limits and price. (b) Override the limit on the subscription. (c) Priced storage add-ons.                                                                                                                                                                                                                                                                 | **Resolved 2026-10-25: (a)**, the operator creates a plan for that customer ("Enterprise - Al-Noor"); customers never see the plan list, so no new code is needed; (c) is revisited when sales show repeated demand. |

The spec cannot be `Approved` while a blocking open question remains.

## 10. Decisions Made in This Spec

| #      | Decision                                                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.5.1 | Per-service forms and attachments are in the MVP, specified in this phase before the request lifecycle.                                                                                                                                           | Owner decision (2026-10-25, Phase 6 pre-spec discussion); amends MVP section 4 ("Attachments and document management" out of scope). Phase 6 then builds on a finished contract instead of reworking submission. |
| P5.5.2 | A service's form is a `jsonb` list on the service, with stable field and option IDs and a revision checked on save.                                                                                                                               | Nothing references a field (answers carry copies, Q2), and the form is read and written whole; the revision prevents lost updates as `baseVersion` does (T35).                                                   |
| P5.5.3 | Uploads send the raw bytes, one file per request, with the name in the query string.                                                                                                                                                              | No multipart parser dependency; percent-encoding carries Arabic names.                                                                                                                                           |
| P5.5.4 | A file's row is written before its bytes, and moves `uploading` → `pending` → `attached`; the storage key is derived from tenant and file ID.                                                                                                     | The database is the one list of stored objects; crashes leave rows the cleanup can find.                                                                                                                         |
| P5.5.5 | Storage sits behind `FileStoreType`, as email sits behind `EmailSenderType` (T19).                                                                                                                                                                | The KSA provider becomes a configuration change; tests use a real S3-compatible server.                                                                                                                          |
| P5.5.6 | Plans carry a required storage limit in whole GB, copied by subscriptions; usage is the sum of every stored file's size, reserved from `Content-Length` under a per-tenant lock before the bytes arrive; over the limit only uploads are refused. | Owner decisions (Q10-Q12); amends D12 (the user count is no longer the only plan limit) and extends D14 and D15 to storage; the reservation keeps concurrent uploads within the limit as T17 does for users.     |
| P5.5.7 | No retention term on plans, and no tenant deletion, in this phase.                                                                                                                                                                                | Owner decision (2026-10-25): how a tenant's data is deleted after its subscription ends is revisited in a future scope.                                                                                          |
| P5.5.8 | Removing an attachment deletes the file: Phase 6 marks it `discarded` with `discardFiles` in its own audited transaction, and the sweep deletes the bytes, then the row.                                                                          | Owner decision (Q14): unused files cost the customer nothing; the row-first order (P5.5.4) still holds, so bytes never outlive their row.                                                                        |
| P5.5.9 | Cleanup is an in-process sweep in each API instance: a 15-minute `setTimeout` chain, batches of 100 under `FOR UPDATE SKIP LOCKED`, bytes deleted before rows, a 2-minute run budget.                                                             | Owner decision (Q8): no job runner before Phase 7; safe with several instances; a failure leaves rows to retry, never bytes without a row.                                                                       |

## 11. Change Log

| Date       | Change                                                                                                                                                                                                                                                          | Reason                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2026-10-25 | Initial draft, with Q1-Q9 open and the recommended options in the design.                                                                                                                                                                                       | Owner split service forms and attachments out of Phase 6 into their own phase. |
| 2026-10-25 | Added the storage limit per plan (R5.5.17-R5.5.21, Q10-Q13, P5.5.6): uploads now require `Content-Length`, and the per-user upload lock became one per-tenant lock serving both the quota and the limit. Recorded that plan retention is out of scope (P5.5.7). | Owner request; Q10-Q12 resolved, retention deferred to a future scope.         |
| 2026-10-25 | Removing an attachment deletes the file (Q14, P5.5.8): new `discarded` state, `discardFiles`, the sweep deletes discarded files; pending discards use the same path.                                                                                            | Owner decision.                                                                |
| 2026-10-25 | Resolved Q1-Q9 and Q13 with the recommended options, except that forms have no field limit (Q1); resolved Q15 (custom plans for customers beyond the largest plan); detailed the cleanup sweep (4.3, P5.5.9).                                                   | Owner answering round.                                                         |
