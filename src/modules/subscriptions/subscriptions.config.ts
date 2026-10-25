/** One GB is 2^30 bytes, the unit object-storage providers bill in (Phase 5.5 spec, 4.1). */
export const BYTES_PER_GB = 1_073_741_824;

export const SUBSCRIPTION_STATES = ["active", "grace", "read_only"] as const;

// "Today" is the calendar date in Saudi Arabia, taken from the database clock so every instance agrees (R1.7).
export const SUBSCRIPTION_TIME_ZONE = "Asia/Riyadh";
