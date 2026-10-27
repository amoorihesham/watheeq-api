import { notificationKinds } from "@/db/schema/index.js";

export const NOTIFICATION_KINDS = notificationKinds.enumValues;

export const RETENTION_DAYS = 90;
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CLEANUP_BATCH_SIZE = 1000;
