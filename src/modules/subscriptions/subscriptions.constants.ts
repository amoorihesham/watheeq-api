/** One GB is 2^30 bytes, the unit object-storage providers bill in (Phase 5.5 spec, 4.1). */
export const BYTES_PER_GB = 1_073_741_824;

export const SUBSCRIPTION_STATES = ["active", "grace", "read_only"] as const;

// "Today" is the calendar date in Saudi Arabia, taken from the database clock so every instance agrees (R1.7).
export const SUBSCRIPTION_TIME_ZONE = "Asia/Riyadh";

// The hourly check (Phase 7 spec, 4.3): "ends soon" starts this many days before the end date.
export const NOTICES_INTERVAL_MS = 60 * 60 * 1000;
export const ENDING_SOON_DAYS = 14;

/** The notification each remembered warning sends. */
export const NOTICE_NOTIFICATION_KINDS = {
  subscription_ending_soon: "subscription.ending_soon",
  subscription_grace_started: "subscription.grace_started",
  subscription_read_only_started: "subscription.read_only_started",
  storage_nearly_full: "storage.nearly_full",
} as const;
