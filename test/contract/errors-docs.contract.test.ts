import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETAIL_CODES, STATUS_BY_CODE } from '@/http/errors.js';
import { tableRows } from './markdown-tables.js';

const rows = tableRows(readFileSync('docs/api/errors.md', 'utf8'));

/** The rows whose first cell is exactly one backticked code matching the pattern. */
const codeRows = (pattern: RegExp) =>
  rows.flatMap((row) => {
    const code = /^`([A-Za-z_]+)`$/.exec(row[0] ?? '')?.[1];
    return code !== undefined && pattern.test(code) ? [{ code, cells: row }] : [];
  });

const documentedErrors = codeRows(/^[A-Z][A-Z_]*$/);
const documentedDetails = codeRows(/^[a-z][a-z_]*$/);

const missing = (expected: string[], documented: { code: string }[]) => expected.filter((code) => !documented.some((row) => row.code === code));
const unknown = (expected: string[], documented: { code: string }[]) => documented.map((row) => row.code).filter((code) => !expected.includes(code));

describe('docs/api/errors.md (C4)', () => {
  const errorCodes = Object.keys(STATUS_BY_CODE);
  const detailCodes = [...DETAIL_CODES] as string[];

  it('lists every error code the server can return', () => {
    expect(missing(errorCodes, documentedErrors)).toEqual([]);
  });

  it('lists no error code that does not exist', () => {
    expect(unknown(errorCodes, documentedErrors)).toEqual([]);
  });

  it('lists each error code once, with its status', () => {
    const statusOf = STATUS_BY_CODE as Record<string, number>;
    const wrong = documentedErrors.flatMap(({ code, cells }) => (cells[1] === String(statusOf[code]) ? [] : [`${code}: ${cells[1]} is not ${statusOf[code]}`]));
    const names = documentedErrors.map((row) => row.code);
    expect(wrong).toEqual([]);
    expect(names.filter((code, index) => names.indexOf(code) !== index)).toEqual([]);
  });

  it('lists every detail code the server can return', () => {
    expect(missing(detailCodes, documentedDetails)).toEqual([]);
  });

  it('lists no detail code that does not exist', () => {
    expect(unknown(detailCodes, documentedDetails)).toEqual([]);
  });

  it('lists each detail code once', () => {
    const names = documentedDetails.map((row) => row.code);
    expect(names.filter((code, index) => names.indexOf(code) !== index)).toEqual([]);
  });
});
