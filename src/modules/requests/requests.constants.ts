export const NUMBER_PREFIX = "REQ";
export const MAX_TITLE_LENGTH = 200;
export const MAX_REASON_LENGTH = 2000;
export const REQUEST_VIEWS = ["waiting_on_me", "handling", "requested", "review_queue"] as const;
export const MAX_REQUEST_FILES = 50;
export const MAX_QUESTION_LENGTH = 4000;
export const MAX_ANSWER_LENGTH = 10000;

// The state a request must still be in when a rule fires (Phase 7 spec, 4.3 "Firing").
export const ESCALATION_RULE_STATES = {
  r0: "in_review",
  r1: "in_progress",
  r2: "in_progress",
} as const;
