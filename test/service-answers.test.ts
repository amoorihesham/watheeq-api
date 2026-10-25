import { describe, expect, it } from "vitest";
import type { FormFieldType } from "../src/modules/services/index.js";
import { snapshotAnswers, validateAnswers } from "../src/modules/services/index.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NAME = id(1);
const VALUE = id(2);
const KIND = id(3);
const START = id(4);
const ARABIC = id(5);
const DRAFT = id(6);
const NOTES = id(7);
const TAGS = id(8);
const SUPPLY = id(11);
const SERVICES = id(12);
const LEASE = id(13);

const field = (extra: object): FormFieldType =>
  ({ helpText: null, required: false, ...extra }) as FormFieldType;

/** Huda's form from the Phase 5.5 spec, section 3, plus a multiple choice. */
const form: FormFieldType[] = [
  field({ id: NAME, type: "short_text", label: "Counterparty name", required: true }),
  field({
    id: VALUE,
    type: "number",
    label: "Contract value (SAR)",
    required: true,
    min: 0,
    max: 1000,
    integer: false,
  }),
  field({
    id: KIND,
    type: "single_choice",
    label: "Contract type",
    required: true,
    options: [
      { id: SUPPLY, label: "Supply" },
      { id: SERVICES, label: "Services" },
      { id: LEASE, label: "Lease" },
    ],
  }),
  field({ id: START, type: "date", label: "Expected start date" }),
  field({ id: ARABIC, type: "yes_no", label: "Needs Arabic translation" }),
  field({ id: DRAFT, type: "file", label: "Draft contract", required: true, maxFiles: 2 }),
  field({ id: NOTES, type: "long_text", label: "Notes" }),
  field({
    id: TAGS,
    type: "multiple_choice",
    label: "Tags",
    options: [
      { id: SUPPLY, label: "Urgent" },
      { id: SERVICES, label: "Renewal" },
    ],
  }),
];

const valid = () => ({
  [NAME]: "Acme",
  [VALUE]: 250,
  [KIND]: SUPPLY,
  [DRAFT]: [id(101)],
});

const codes = (answers: Record<string, unknown>, fields = form) =>
  validateAnswers(fields, answers).map((detail) => `${detail.path}:${detail.code}`);
const at = (fieldId: string, code: string) => `answers.${fieldId}:${code}`;

describe("validateAnswers (R5.5.7)", () => {
  it("accepts the required answers alone, and every type answered", () => {
    expect(codes(valid())).toEqual([]);
    expect(
      codes({
        ...valid(),
        [START]: "2026-02-28",
        [ARABIC]: false,
        [NOTES]: "Please hurry",
        [TAGS]: [SUPPLY, SERVICES],
        [DRAFT]: [id(101), id(102)],
      }),
    ).toEqual([]);
  });

  it("asks for every required field, treating null, blank, and empty lists as unanswered", () => {
    expect(codes({})).toEqual([
      at(NAME, "required"),
      at(VALUE, "required"),
      at(KIND, "required"),
      at(DRAFT, "required"),
    ]);
    expect(codes({ [NAME]: "   ", [VALUE]: null, [KIND]: "", [DRAFT]: [] })).toEqual([
      at(NAME, "required"),
      at(VALUE, "required"),
      at(KIND, "required"),
      at(DRAFT, "required"),
    ]);
  });

  it("counts yes/no false and the number 0 as answered", () => {
    const answered = [
      field({ id: ARABIC, type: "yes_no", label: "A", required: true }),
      field({
        id: VALUE,
        type: "number",
        label: "V",
        required: true,
        min: null,
        max: null,
        integer: false,
      }),
    ];
    expect(codes({ [ARABIC]: false, [VALUE]: 0 }, answered)).toEqual([]);
  });

  it("does not require optional fields, and ignores their empty answers", () => {
    expect(codes({ ...valid(), [START]: null, [NOTES]: "", [TAGS]: [] })).toEqual([]);
  });

  it("flags text that is not text or too long, at each type's limit", () => {
    expect(codes({ ...valid(), [NAME]: 5 })).toEqual([at(NAME, "wrong_type")]);
    expect(codes({ ...valid(), [NAME]: "x".repeat(500) })).toEqual([]);
    expect(codes({ ...valid(), [NAME]: "x".repeat(501) })).toEqual([at(NAME, "too_long")]);
    expect(codes({ ...valid(), [NOTES]: "x".repeat(10_000) })).toEqual([]);
    expect(codes({ ...valid(), [NOTES]: "x".repeat(10_001) })).toEqual([at(NOTES, "too_long")]);
    expect(codes({ ...valid(), [NAME]: "😀".repeat(500) })).toEqual([]);
  });

  it("flags numbers that are not numbers, below the minimum, above the maximum", () => {
    expect(codes({ ...valid(), [VALUE]: "250" })).toEqual([at(VALUE, "wrong_type")]);
    expect(codes({ ...valid(), [VALUE]: -5 })).toEqual([at(VALUE, "below_minimum")]);
    expect(codes({ ...valid(), [VALUE]: 0 })).toEqual([]);
    expect(codes({ ...valid(), [VALUE]: 1000 })).toEqual([]);
    expect(codes({ ...valid(), [VALUE]: 1000.5 })).toEqual([at(VALUE, "above_maximum")]);
    expect(codes({ ...valid(), [VALUE]: true })).toEqual([at(VALUE, "wrong_type")]);
  });

  it("flags a fraction in a whole-number field, and allows one otherwise", () => {
    const whole = [
      field({ id: VALUE, type: "number", label: "V", min: null, max: null, integer: true }),
    ];
    expect(codes({ [VALUE]: 2.5 }, whole)).toEqual([at(VALUE, "not_integer")]);
    expect(codes({ [VALUE]: 3 }, whole)).toEqual([]);
    expect(codes({ ...valid(), [VALUE]: 2.5 })).toEqual([]);
  });

  it("checks dates as real Gregorian calendar dates", () => {
    for (const date of ["2026-02-28", "2028-02-29", "2000-02-29", "2026-12-31", "0001-01-01"]) {
      expect(codes({ ...valid(), [START]: date })).toEqual([]);
    }
    for (const date of [
      "2026-02-29",
      "1900-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-1-5",
      "26-01-01",
      "2026-01-01T00:00:00Z",
      "0000-01-01",
      "tomorrow",
    ]) {
      expect(codes({ ...valid(), [START]: date })).toEqual([at(START, "invalid_date")]);
    }
    expect(codes({ ...valid(), [START]: 20260228 })).toEqual([at(START, "wrong_type")]);
  });

  it("flags yes/no that is not a boolean", () => {
    expect(codes({ ...valid(), [ARABIC]: "yes" })).toEqual([at(ARABIC, "wrong_type")]);
    expect(codes({ ...valid(), [ARABIC]: 1 })).toEqual([at(ARABIC, "wrong_type")]);
  });

  it("checks a single choice by option ID", () => {
    expect(codes({ ...valid(), [KIND]: id(99) })).toEqual([at(KIND, "unknown_option")]);
    expect(codes({ ...valid(), [KIND]: "Supply" })).toEqual([at(KIND, "unknown_option")]);
    expect(codes({ ...valid(), [KIND]: [SUPPLY] })).toEqual([at(KIND, "wrong_type")]);
  });

  it("checks a multiple choice: a list of known options without repeats", () => {
    expect(codes({ ...valid(), [TAGS]: SUPPLY })).toEqual([at(TAGS, "wrong_type")]);
    expect(codes({ ...valid(), [TAGS]: [SUPPLY, 4] })).toEqual([at(TAGS, "wrong_type")]);
    expect(codes({ ...valid(), [TAGS]: [SUPPLY, LEASE] })).toEqual([at(TAGS, "unknown_option")]);
    expect(codes({ ...valid(), [TAGS]: [SUPPLY, SUPPLY] })).toEqual([at(TAGS, "duplicate_option")]);
  });

  it("checks a file answer as a list of IDs within the field's maximum", () => {
    expect(codes({ ...valid(), [DRAFT]: id(101) })).toEqual([at(DRAFT, "wrong_type")]);
    expect(codes({ ...valid(), [DRAFT]: ["not-an-id"] })).toEqual([at(DRAFT, "wrong_type")]);
    expect(codes({ ...valid(), [DRAFT]: [id(101), id(101)] })).toEqual([at(DRAFT, "wrong_type")]);
    expect(codes({ ...valid(), [DRAFT]: [id(101), id(102), id(103)] })).toEqual([
      at(DRAFT, "too_many_files"),
    ]);
  });

  it("flags an answer for a field the form does not have", () => {
    expect(codes({ ...valid(), [id(500)]: "x" })).toEqual([at(id(500), "unknown_field")]);
    expect(codes({ ...valid(), "Counterparty name": "Acme" })).toEqual([
      at("Counterparty name", "unknown_field"),
    ]);
  });

  it("reports every problem field once", () => {
    expect(codes({ [NAME]: 1, [VALUE]: -1, [KIND]: "x", [id(500)]: 1 })).toEqual([
      at(NAME, "wrong_type"),
      at(VALUE, "below_minimum"),
      at(KIND, "unknown_option"),
      at(DRAFT, "required"),
      at(id(500), "unknown_field"),
    ]);
  });
});

describe("snapshotAnswers (R5.5.8)", () => {
  it("copies each answered field's definition in form order, with the chosen options' labels", () => {
    const answers = { ...valid(), [TAGS]: [SERVICES, SUPPLY], [ARABIC]: false, [NOTES]: " " };
    const snapshot = snapshotAnswers(form, answers);

    expect(snapshot.map((entry) => entry.field.id)).toEqual([
      NAME,
      VALUE,
      KIND,
      ARABIC,
      DRAFT,
      TAGS,
    ]);
    expect(snapshot[0]).toEqual({ field: form[0], value: "Acme" });
    expect(snapshot[2]).toEqual({
      field: form[2],
      value: SUPPLY,
      chosen: [{ id: SUPPLY, label: "Supply" }],
    });
    expect(snapshot[3]).toEqual({ field: form[4], value: false });
    expect(snapshot[5]).toEqual({
      field: form[7],
      value: [SERVICES, SUPPLY],
      chosen: [
        { id: SERVICES, label: "Renewal" },
        { id: SUPPLY, label: "Urgent" },
      ],
    });
  });

  it("is a deep copy: renaming the field afterwards does not change it", () => {
    const edited = structuredClone(form);
    const snapshot = snapshotAnswers(edited, valid());
    const kind = edited[2];
    if (kind?.type !== "single_choice") {
      throw new Error("fixture");
    }
    kind.label = "Agreement type";
    kind.options[0] = { id: SUPPLY, label: "Goods" };
    expect(snapshot[2]?.field.label).toBe("Contract type");
    expect(snapshot[2]?.chosen).toEqual([{ id: SUPPLY, label: "Supply" }]);
  });

  it("refuses answers that were never validated", () => {
    expect(() => snapshotAnswers(form, { ...valid(), [KIND]: id(99) })).toThrow();
  });
});
