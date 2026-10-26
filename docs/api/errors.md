# Errors

Every error has the same JSON shape, written only by `src/middleware/error-handler.ts`.

```json
{
  "error": {
    "code": "TAKEN",
    "requestId": "4f1c...",
    "details": [{ "path": "name", "code": "taken" }]
  }
}
```

- There is no human-readable message: a client words every message from `code` and the detail codes, in Arabic or English.
- `details` is always an array, empty when no input is to blame, and each detail is exactly `{path, code}`.
- `path` is a place in the request input: a body field (`name`, `stages.2.position`), a query parameter (`cursor`, `unread`), or `""` when the problem is the whole body or no single field.
  A path is never anything else.
- Every error caused by one input field has a detail at that field's path, so a client can mark the field.
- An unknown route is 404 `NOT_FOUND` with `details: []`.
- A client can quote `requestId` when reporting a problem; the server logs the same ID.

## What each status means

| Status | Meaning | Codes |
| ------ | ------- | ----- |
| 400 | The input is wrong | `VALIDATION_FAILED`, `VERIFICATION_INVALID` |
| 401 | Not logged in, or the session expired | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | Logged in, but not allowed | `FORBIDDEN`, `PERMISSION_NOT_HELD`, `SELF_CHANGE_FORBIDDEN`, `SUBSCRIPTION_READ_ONLY`, `SUBSCRIPTION_NOT_ACTIVE` |
| 404 | The thing does not exist, or the caller may not see it | `NOT_FOUND` |
| 409 | The input is valid but conflicts with the current state | `TAKEN`, `VERSION_CHANGED`, and the state codes |
| 411, 413, 415 | The transport is wrong (length, size, type) | `LENGTH_REQUIRED`, `PAYLOAD_TOO_LARGE`, `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `FILE_TYPE_NOT_ALLOWED` |
| 500 | A server fault | `INTERNAL` |
| 503 | A dependency is down | `SERVICE_UNAVAILABLE` |

500 `INTERNAL` is only for server faults.
Every client error raised by Express or the body parser maps to a code in the tables below.
A path parameter that cannot be decoded (`GET /users/%zz`) is answered like any unknown ID: 404 `NOT_FOUND`.

## Error codes

| Code | Status | Meaning | What a client does |
| ---- | ------ | ------- | ------------------ |
| `VALIDATION_FAILED` | 400 | The input is invalid; `details` names each problem (detail codes below), or `invalid_json` when the body is not JSON | Marks each field at its `path` and words each message from its detail code |
| `VERIFICATION_INVALID` | 400 | An emailed link's token is unknown, used, replaced, or expired | Tells the user the link no longer works and offers to request a new one |
| `UNAUTHENTICATED` | 401 | There is no valid access token, or the session ended | Calls `POST /auth/refresh` once and retries; if that fails too, shows the login page |
| `INVALID_CREDENTIALS` | 401 | The login failed (any reason), or the current password of a password change is wrong | Tells the user the email or password is wrong, without saying which |
| `FORBIDDEN` | 403 | The caller's role lacks the route's permission, or a tenant user called an operator route or the reverse; `details` is `[]` | Hides or disables the action; shows "you cannot do this" if it was reached anyway |
| `PERMISSION_NOT_HELD` | 403 | A write would grant or touch a permission the actor does not hold at that scope (the subset rule); `details` holds one `permission_not_held` at each body entry that asked for it, or `[]` when no input asked for it | Marks the offending entries (`permissions.3`) and refreshes the actor's role |
| `SELF_CHANGE_FORBIDDEN` | 403 | The caller tried to change their own role or deactivate themselves | Hides the action on the caller's own row |
| `SUBSCRIPTION_READ_ONLY` | 403 | The tenant's subscription is Read-only and the call changes data (`access.md`) | Shows the renewal notice; keeps reads working |
| `SUBSCRIPTION_NOT_ACTIVE` | 403 | The route needs an Active subscription and the tenant is in Grace or Read-only (submitting a request) | Shows that submission is paused until renewal |
| `NOT_FOUND` | 404 | The route, the thing, or a path ID does not exist, or exists but the caller may not see it; the two cases look the same | Shows "not found" and goes back to the list |
| `TAKEN` | 409 | A unique value is already used; `details` is one `taken` at the field (`email`, `slug`, `name`, `admin.email`) | Marks the field as already used |
| `VERSION_CHANGED` | 409 | The resource changed since the client read it; `details` is one detail at `baseVersion` or `baseRevision` | Reloads the resource and asks the user to redo or merge the edit |
| `ALREADY_VERIFIED` | 409 | A verification or invitation email was requested for someone who already set a password | Refreshes the row; the action is no longer needed |
| `USER_LIMIT_REACHED` | 409 | Adding or reactivating a member would pass the plan's user limit | Tells Sara the limit is reached and points to the subscription |
| `UNIT_NOT_EMPTY` | 409 | The org unit still has sections or members | Asks the user to move them first |
| `OWNER_PROTECTED` | 409 | The tenant's owner cannot be demoted or deactivated | Hides the action on the owner's row |
| `USER_INACTIVE` | 409 | An invitation was resent to a deactivated user | Offers to reactivate the user first |
| `ROLE_IN_USE` | 409 | A role someone still holds cannot be deleted | Asks the user to reassign its holders first |
| `ROLE_PROTECTED` | 409 | The Tenant Admin role cannot be edited or deleted | Hides the action on that role |
| `CALENDAR_DATE_LOCKED` | 409 | The calendar change would alter a day up to and including today | Asks for a later date |
| `CALENDAR_PERIOD_ENDED` | 409 | The period version was already ended by an earlier edit | Reloads the calendar |
| `POSITION_IN_USE` | 409 | A workflow or escalation setting still depends on the position | Lists what must change first |
| `POSITION_UNIT_GONE` | 409 | A position to restore belongs to a deleted unit | Tells the user the position cannot be restored |
| `RESOURCE_RETIRED` | 409 | A retired position, workflow, service, or priority cannot be edited | Offers to restore it first |
| `WORKFLOW_POSITION_RETIRED` | 409 | A workflow to restore names a retired position | Asks the user to restore the position first |
| `WORKFLOW_IN_USE` | 409 | A service still allows the workflow, so it cannot be retired | Lists the services to change first |
| `SERVICE_WORKFLOW_RETIRED` | 409 | A service to restore allows a retired workflow | Asks the user to restore the workflow first |
| `ESCALATION_NOT_CONFIGURED` | 409 | The tenant has not saved its escalation settings, so requests cannot be submitted | Sends a user with `escalation.manage` to the settings, and tells others to ask their admin |
| `INVALID_REQUEST_STATE` | 409 | The action is not allowed in the request's current state | Reloads the request; its state decides which actions to show |
| `STAGE_NOT_ACTIVE` | 409 | The stage run is not the request's live run any more | Reloads the request |
| `NO_EARLIER_STAGE` | 409 | The first stage that ran cannot be returned | Hides the action on the first stage |
| `NO_HIGHER_LEVEL` | 409 | Escalation went past the department's managers | Tells the handler there is nobody higher |
| `INFORMATION_REQUEST_OPEN` | 409 | A second information request while one is open | Reloads the request and shows the open question |
| `NO_OPEN_INFORMATION_REQUEST` | 409 | The action needs an open information request and none is open | Reloads the request |
| `TOO_MANY_FILES` | 409 | More than 50 files on one request | Tells the user the file limit is reached |
| `UPLOAD_QUOTA_REACHED` | 409 | The uploader already has 20 pending uploads | Asks the user to attach or remove pending files |
| `STORAGE_LIMIT_REACHED` | 409 | The upload would pass the tenant's storage limit | Tells the user storage is full |
| `LENGTH_REQUIRED` | 411 | An upload without `Content-Length` | A client bug: send the file as one body with its length |
| `PAYLOAD_TOO_LARGE` | 413 | A JSON body over 100 KB | A client bug: the screens never send this much |
| `FILE_TOO_LARGE` | 413 | An upload over 25 MB | Tells the user the file is too large |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | A body without `Content-Type: application/json` | A client bug: set the content type |
| `FILE_TYPE_NOT_ALLOWED` | 415 | The detected type of an upload is not allowed or does not match its extension | Tells the user which file types are accepted |
| `INTERNAL` | 500 | A server fault | Shows a generic error with the `requestId`; may retry a read once |
| `SERVICE_UNAVAILABLE` | 503 | `GET /health` cannot reach the database | A monitor treats the instance as down |

## Detail codes

A detail code says what is wrong at a `path`.
The first group is the codes zod reports for the shape of the input, the second the codes the API raises itself, and the third the codes of single endpoints.

### Shape of the input

| Code | Meaning | Example |
| ---- | ------- | ------- |
| `invalid_type` | The value is not the type the field takes (a number where text is expected, or a missing required field) | `name` is missing |
| `too_small` | Below the minimum length, size, or value; also a blank required text | `name` is `""`, or `limit=0` |
| `too_big` | Above the maximum length, size, or value | `limit=101` |
| `invalid_format` | The text does not have the required format | `email` is not an email address |
| `invalid_value` | The value is not one of the accepted values | `unread=maybe`, `paymentPeriod` is `weekly` |
| `not_multiple_of` | The number is not a multiple of the required step | A discount with three decimals |
| `invalid_union` | The value matches none of the accepted shapes | A stage assignee that is neither a position nor a built-in |
| `invalid_key` | A key of a map is not an accepted key | A key of a map that fails the key's rule |
| `invalid_element` | An element of a set or map is not accepted | An element of the wrong form |
| `unknown_field` | The body holds a field the endpoint does not accept | `admin.phone` |
| `no_fields` | A `PATCH` body with no field to change; path `""` | `{}` |
| `invalid_json` | The body is not valid JSON; path `""` | `{"name":` |
| `invalid_cursor` | The cursor is broken, altered, or from another list or other filters | `cursor` |
| `taken` | The value is already used; comes with `TAKEN` | `name` |
| `permission_not_held` | The actor does not hold the permission at that scope; comes with `PERMISSION_NOT_HELD` | `permissions.3` |

### Values that depend on other data

| Code | Meaning | Example path |
| ---- | ------- | ------------ |
| `required` | A value the current kind or form needs is missing | `answers.<fieldId>`, `start` |
| `not_allowed` | A value was sent where the current kind or setting does not take one | `endDate` of a holiday that is not one-off |
| `unknown_unit` | The org unit does not exist in this tenant | `unitId`, `parentId` |
| `unknown_role` | The role does not exist in this tenant | `roleId` |
| `unknown_plan` | The plan does not exist | `planId`, `subscription.planId` |
| `unknown_position` | The position does not exist in this tenant | `stages.0.assignee.position` |
| `unknown_workflow` | The workflow does not exist | `workflows.0.id`, `workflowId` |
| `unknown_service` | The service does not exist | `serviceId` |
| `unknown_priority` | The priority does not exist | `priorityId` |
| `unknown_permission` | The permission key is not in the catalog | `permissions.2.key` |
| `unknown_notification` | The notification does not exist or is not the caller's | `upTo` |
| `unknown_file` | The file does not exist, or is not the caller's pending upload | `fileIds.0` |
| `unknown_field_id` | A form field ID that is not in the form | `fields.1.id` |
| `unknown_option_id` | A form option ID that is not in the field | `fields.1.options.0.id` |
| `unknown_option` | An answer names an option the form field does not have | `answers.<fieldId>` |
| `priority_retired` | The priority is retired | `priorityId` |
| `service_retired` | The service is retired | `serviceId` |
| `workflow_retired` | The workflow is retired | `workflowId` |
| `position_retired` | The position is retired | `stages.0.assignee.position` |
| `workflow_not_allowed` | The service does not allow that workflow | `workflowId` |
| `file_attached` | The file is already attached to a record, or repeated in the list | `fileIds.1` |
| `file_expired` | The pending upload expired | `fileIds.0` |
| `not_unit_member` | The user is not a member of the position's unit | `userIds.2` |
| `holds_other_position` | The user already holds another position | `userIds.2` |
| `user_inactive` | The user is deactivated | `userIds.2` |
| `not_assignee` | The user is not an assignee of the stage | `userIds.0` |
| `handler_is_requester` | The handler cannot be the requester | `handlerId` |
| `handler_not_eligible` | The person may not handle requests | `handlerId` |
| `same_handler` | The person already handles the request | `handlerId` |
| `manager_needs_unit` | A manager must be placed in a unit | `isManager` |
| `parent_not_department` | A section's parent must be a department | `parentId` |
| `department_has_no_parent` | A department has no parent | `parentId` |
| `scope_not_allowed` | The permission does not allow that scope | `permissions.1.scope` |

### Rules of one endpoint

| Code | Meaning | Example path |
| ---- | ------- | ------------ |
| `end_before_start` | The end is before the start | `endDate`, `to` |
| `in_future` | A subscription cannot start after today | `startDate`, `subscription.startDate` |
| `too_many_decimals` | More decimals than the field allows | `discountPercent` |
| `invalid_day` | The day does not exist in that month | `start.day` |
| `no_working_day` | A week with every day off | `days` |
| `period_too_long` | A calendar period longer than allowed | `endDate` |
| `range_too_long` | A day view longer than 366 days | `to` |
| `too_far_ahead` | A calendar date too far ahead of today | `startDate`, `year` |
| `no_occurrence` | The recurring period has no occurrence in that year | `year` |
| `not_recurring` | The period does not recur | `periodId` |
| `rank_taken` | Another season already has that rank | `rank` |
| `duplicate_name` | The same stage name twice in a workflow | `stages.1.name` |
| `too_many_stages` | More stages than a workflow may have | `stages` |
| `duplicate_workflow` | The same workflow twice in a service | `workflows.1.id` |
| `no_default` | A service with no default workflow | `workflows` |
| `many_defaults` | A service with several default workflows | `workflows.1.isDefault` |
| `duplicate_label` | The same field label twice in a form | `fields.1.label` |
| `duplicate_field_id` | The same field ID twice in a form | `fields.1.id` |
| `duplicate_option` | The same option twice in a field or an answer | `fields.0.options.1.label` |
| `min_above_max` | A number field whose minimum exceeds its maximum | `fields.0.min` |
| `type_changed` | A form field's type cannot change | `fields.0.type` |
| `duplicate_permission` | The same permission key twice in a role | `permissions.1` |
| `duplicate_recipient` | The same recipient twice in an escalation rule | `r0.recipients.1` |
| `duplicate_user` | The same user twice in a list | `userIds.1` |
| `no_recipients` | An escalation rule that is on has no recipient | `r0.recipients` |
| `not_for_rule` | A built-in recipient that the rule cannot resolve, because it has no handler yet | `r0.recipients.0` |
| `order_mismatch` | The priority order does not hold exactly the active priorities | `ids` |
| `invalid_name` | A file name that is not acceptable | `name` |
| `empty_file` | An upload with no bytes | `""` |
| `length_mismatch` | The body is not as long as `Content-Length` says | `""` |
| `wrong_type` | An answer has the wrong type for its form field | `answers.<fieldId>` |
| `too_long` | A text answer is longer than the field allows | `answers.<fieldId>` |
| `not_integer` | A number answer must be a whole number | `answers.<fieldId>` |
| `below_minimum` | A number answer is below the field's minimum | `answers.<fieldId>` |
| `above_maximum` | A number answer is above the field's maximum | `answers.<fieldId>` |
| `invalid_date` | A date answer is not a real calendar day | `answers.<fieldId>` |
| `too_many_files` | A file answer holds more files than the field allows | `answers.<fieldId>` |
