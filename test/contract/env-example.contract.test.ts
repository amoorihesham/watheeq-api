import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { cliEnvSchema, envSchema } from '../../src/config/config.js';

interface LineType {
  value: string;
  commented: boolean;
}

/** `KEY=value` is a set key; `# KEY=value` is a commented override. Prose comments do not match. */
function readEnvExample(): Map<string, LineType> {
  const keys = new Map<string, LineType>();
  for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
    const match = /^(# )?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[2] !== undefined) {
      expect(keys.has(match[2]), `${match[2]} appears twice in .env.example`).toBe(false);
      keys.set(match[2], { value: match[3] ?? '', commented: match[1] !== undefined });
    }
  }
  return keys;
}

const example = readEnvExample();
const set: Record<string, string> = {};
for (const [key, line] of example) {
  if (!line.commented) {
    set[key] = line.value;
  }
}

const schemas: Array<[string, z.ZodObject]> = [
  ['server', envSchema],
  ['CLI', cliEnvSchema],
];

describe('R9.9: .env.example matches the config schemas', () => {
  it('lists exactly the keys the schemas know', () => {
    const known = new Set([...Object.keys(envSchema.shape), ...Object.keys(cliEnvSchema.shape)]);
    expect([...example.keys()].sort()).toEqual([...known].sort());
  });

  it('sets a valid value for every key it does not comment out', () => {
    for (const [name, schema] of schemas) {
      const result = schema.safeParse(set);
      expect(result.success, `${name} schema rejects the set keys of .env.example`).toBe(true);
    }
  });

  it("gives every commented key the schema's default", () => {
    for (const [key, line] of example) {
      if (!line.commented || line.value === '') {
        continue;
      }
      const schema = schemas.find(([, s]) => key in s.shape)?.[1];
      expect(schema, `${key} is in no schema`).toBeDefined();
      const without = schema?.parse(set) as Record<string, unknown>;
      const withValue = schema?.parse({ ...set, [key]: line.value }) as Record<string, unknown>;
      expect(withValue[key], `${key} in .env.example is not the schema default`).toEqual(without[key]);
    }
  });
});
