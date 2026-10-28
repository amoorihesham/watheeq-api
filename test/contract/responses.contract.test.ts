import { describe, expect, it } from 'vitest';
import { moduleFiles } from './source-files.js';

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Every match of the pattern in files with the suffix, as `path:line`. */
function offences(suffix: string, pattern: RegExp): string[] {
  return moduleFiles(suffix).flatMap((file) => [...file.text.matchAll(pattern)].map((match) => `${file.path}:${lineOf(file.text, match.index)}`));
}

describe('controllers (C1)', () => {
  // Responses are written only through sendData, sendPage, and sendNoContent (R8.15); sendDownload stays allowed.
  it('never write a response body or status directly', () => {
    const direct = /\bres\s*\.\s*(json|send|end|sendStatus|jsonp)\s*\(|\.status\([^)]*\)\s*\.\s*(json|send|end)\s*\(/g;
    expect(offences('.controller.ts', direct)).toEqual([]);
  });
});

describe('response schemas', () => {
  // A response field is always present and `null` when empty (R8.4), so response schemas are strict objects with no
  // optional keys, as T25's test requires strict objects for request bodies.
  it('are strict objects without optional keys', () => {
    const loose = /\bz\s*\.\s*object\s*\(|\.(optional|nullish|partial)\s*\(/g;
    expect(offences('.responses.ts', loose)).toEqual([]);
  });
});
