export const MAX_SERVICE_NAME_LENGTH = 100;
export const MAX_SERVICE_DESCRIPTION_LENGTH = 2000;
export const MAX_FIELD_LABEL_LENGTH = 200;
export const MAX_FIELD_HELP_TEXT_LENGTH = 500;
export const MAX_SHORT_TEXT_LENGTH = 500;
export const MAX_LONG_TEXT_LENGTH = 10_000;
export const MAX_OPTIONS_PER_FIELD = 50;
export const MAX_OPTION_LABEL_LENGTH = 200;
export const MAX_FILES_PER_FIELD = 10;

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "date",
  "single_choice",
  "multiple_choice",
  "yes_no",
  "file",
] as const;

/** The settings each field type has; every other setting is `null` in a response (Phase 8, R8.4). */
export const FIELD_SETTINGS = {
  number: ["min", "max", "integer"],
  single_choice: ["options"],
  multiple_choice: ["options"],
  file: ["maxFiles"],
} as const satisfies Partial<Record<(typeof FIELD_TYPES)[number], readonly string[]>>;

export const ALL_FIELD_SETTINGS = ["min", "max", "integer", "options", "maxFiles"] as const;
