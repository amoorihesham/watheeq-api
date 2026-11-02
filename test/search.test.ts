import { describe, expect, it } from 'vitest';
import { containing } from '../src/db/search.js';

describe('containing (R11.6)', () => {
  it('wraps the text in % and escapes %, _, and \\ so they match literally', () => {
    expect(containing('noor')).toBe('%noor%');
    expect(containing('100%')).toBe('%100\\%%');
    expect(containing('a_b')).toBe('%a\\_b%');
    expect(containing('c:\\x')).toBe('%c:\\\\x%');
  });
});
