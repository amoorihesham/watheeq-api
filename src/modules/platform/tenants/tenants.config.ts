export const MAX_TENANT_NAME_LENGTH = 100;
export const MAX_REASON_LENGTH = 500;
// Lowercase letters, digits, and hyphens, 2-50 characters, for example "al-noor". Mirrored by tenants_slug_format.
export const SLUG_PATTERN = /^[a-z0-9-]{2,50}$/;
