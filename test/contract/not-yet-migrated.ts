/**
 * Module folders under `src/modules` that Phase 8 has not moved to the response helpers and response schemas yet.
 * The response contract tests skip them; steps 8.3 and 8.4 remove entries until the list is empty.
 */
export const NOT_YET_MIGRATED: string[] = [
  "auth",
  "calendar",
  "escalation",
  "files",
  "health",
  "notifications",
  "org",
  "platform",
  "positions",
  "priorities",
  "requests",
  "roles",
  "services",
  "subscriptions",
  "tenant-access",
  "users",
  "workflows",
];
