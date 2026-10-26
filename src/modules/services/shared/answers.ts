import { z } from "zod";
import type { DetailCode, ErrorDetail } from "@/http/errors.js";
import { MAX_LONG_TEXT_LENGTH, MAX_SHORT_TEXT_LENGTH } from "../services.config.js";
import type { FormFieldType, FormOptionType } from "./form.js";

export type AnswersType = Record<string, unknown>;

/** One answered field as stored with a request: a copy of the field's definition, so later edits never change it (R5.5.8). */
export interface AnswerSnapshotType {
  field: FormFieldType;
  value: unknown;
  /** For choice fields, the chosen options with the labels they had when answered. */
  chosen?: FormOptionType[];
}

const isFileId = (value: unknown) => z.uuid().safeParse(value).success;
const codePoints = (text: string) => Array.from(text).length;

function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year >= 1 && daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

/** An answer that says nothing: absent, null, blank text, or an empty list. */
function isUnanswered(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return Array.isArray(value) && value.length === 0;
}

/** The first problem with an answer to this field, as a detail code, or undefined when it is valid. */
function problemWith(field: FormFieldType, value: unknown): DetailCode | undefined {
  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") {
        return "wrong_type";
      }
      const max = field.type === "short_text" ? MAX_SHORT_TEXT_LENGTH : MAX_LONG_TEXT_LENGTH;
      return codePoints(value) > max ? "too_long" : undefined;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "wrong_type";
      }
      if (field.integer && !Number.isInteger(value)) {
        return "not_integer";
      }
      if (field.min !== null && value < field.min) {
        return "below_minimum";
      }
      return field.max !== null && value > field.max ? "above_maximum" : undefined;
    }
    case "date": {
      if (typeof value !== "string") {
        return "wrong_type";
      }
      return isCalendarDate(value) ? undefined : "invalid_date";
    }
    case "yes_no":
      return typeof value === "boolean" ? undefined : "wrong_type";
    case "single_choice": {
      if (typeof value !== "string") {
        return "wrong_type";
      }
      return field.options.some((option) => option.id === value) ? undefined : "unknown_option";
    }
    case "multiple_choice": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return "wrong_type";
      }
      const ids = value as string[];
      if (!ids.every((id) => field.options.some((option) => option.id === id))) {
        return "unknown_option";
      }
      return new Set(ids).size === ids.length ? undefined : "duplicate_option";
    }
    case "file": {
      if (!Array.isArray(value) || !value.every(isFileId) || new Set(value).size !== value.length) {
        return "wrong_type";
      }
      return value.length > field.maxFiles ? "too_many_files" : undefined;
    }
  }
}

/**
 * Checks a submission's answers (keyed by field ID) against the form (R5.5.7): every required field answered,
 * every answer of its field's type and within its settings, none for a field the form lacks. One detail per
 * problem field, at `answers.<field ID>`. A file answer is checked only as a list of IDs; attaching checks the files.
 */
export function validateAnswers(form: FormFieldType[], answers: AnswersType): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  const known = new Set(form.map((field) => field.id));
  for (const field of form) {
    const path = `answers.${field.id}`;
    const value = answers[field.id];
    if (isUnanswered(value)) {
      if (field.required) {
        details.push({ path, code: "required" });
      }
      continue;
    }
    const problem = problemWith(field, value);
    if (problem) {
      details.push({ path, code: problem });
    }
  }
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) {
      details.push({ path: `answers.${key}`, code: "unknown_field" });
    }
  }
  return details;
}

/**
 * The answered fields in form order, each with a copy of its field's definition (R5.5.8). The answers must have
 * passed `validateAnswers`; an unanswered optional field has no entry.
 */
export function snapshotAnswers(form: FormFieldType[], answers: AnswersType): AnswerSnapshotType[] {
  return form.flatMap((field) => {
    const value = answers[field.id];
    if (isUnanswered(value)) {
      return [];
    }
    const copy = structuredClone(field);
    if (copy.type !== "single_choice" && copy.type !== "multiple_choice") {
      return [{ field: copy, value }];
    }
    const chosenIds = Array.isArray(value) ? (value as string[]) : [value];
    const chosen = chosenIds.map((id) => {
      const option = copy.options.find((candidate) => candidate.id === id);
      if (!option) {
        throw new Error("snapshotAnswers needs answers that passed validateAnswers");
      }
      return option;
    });
    return [{ field: copy, value, chosen }];
  });
}
