import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const OPENAPI_FILE = 'docs/api/openapi.json';
export const TRAILER_KEY = 'Contract-change';

// A release at least two weeks old, pinned by digest so a retagged image cannot change the verdict.
const OASDIFF_IMAGE = 'tufin/oasdiff:v1.34.0@sha256:dd742562c1f3146f6e2a80bc01951cc87d15a249ac2aca05665339e30cf03620';
const FRONTEND_ISSUE = /^amoorihesham\/watheeq-frontend#[1-9][0-9]*$/;
// oasdiff's levels: 3 is a definite break, 2 a possible one, 1 an addition.
const INFO_LEVEL = 1;
// A new error or detail code is a heads-up, since a client handles an unknown code by its status (docs/api/errors.md).
const NEW_CODE = /^added the new `([^`]+)` enum value to the `error\/(?:details\/items\/)?code` response property/;
const IGNORED_CHECKS = new Set(['api-version-not-bumped']);

export type OasdiffChangeType = { id: string; text: string; level: number; operation?: string; path?: string };

/** One change, with every operation it reaches; oasdiff reports a change to a shared schema once per operation. */
export type GroupedChangeType = { text: string; operations: string[] };

export type ClassifiedType = { contractChanges: GroupedChangeType[]; additions: GroupedChangeType[]; newCodes: string[] };

function group(changes: OasdiffChangeType[]): GroupedChangeType[] {
  const byText = new Map<string, Set<string>>();
  for (const change of changes) {
    const operations = byText.get(change.text) ?? new Set<string>();
    if (change.operation && change.path) {
      operations.add(`${change.operation} ${change.path}`);
    }
    byText.set(change.text, operations);
  }
  return [...byText].map(([text, operations]) => ({ text, operations: [...operations].sort() }));
}

/** Splits oasdiff's changelog into contract changes, additions, and new error or detail codes (FRONTEND_COLLABORATION.md, section 5). */
export function classify(changes: OasdiffChangeType[]): ClassifiedType {
  const newCodes = new Set<string>();
  const breaking: OasdiffChangeType[] = [];
  const additions: OasdiffChangeType[] = [];
  for (const change of changes.filter(({ id }) => !IGNORED_CHECKS.has(id))) {
    const code = NEW_CODE.exec(change.text)?.[1];
    if (code) {
      newCodes.add(code);
    } else if (change.level > INFO_LEVEL) {
      breaking.push(change);
    } else {
      additions.push(change);
    }
  }
  return { contractChanges: group(breaking), additions: group(additions), newCodes: [...newCodes].sort() };
}

/** Reads the `Contract-change:` trailer values, one per line, into the valid frontend issues and the malformed values. */
export function parseTrailers(output: string): { issues: string[]; malformed: string[] } {
  const values = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return { issues: [...new Set(values.filter((value) => FRONTEND_ISSUE.test(value)))], malformed: values.filter((value) => !FRONTEND_ISSUE.test(value)) };
}

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The document at a revision, or the working tree's when no revision is given. */
export function documentAt(revision: string | undefined): string {
  return revision ? git(['show', `${revision}:${OPENAPI_FILE}`]) : readFileSync(OPENAPI_FILE, 'utf8');
}

/** The `Contract-change:` trailer values of the commits after `base` up to `head`. */
export function trailersBetween(base: string, head: string): string {
  return git(['log', `--format=%(trailers:key=${TRAILER_KEY},valueonly,separator=%x0A)`, `${base}..${head}`]);
}

/** Runs oasdiff's changelog on two documents, at every level. */
export function oasdiffChangelog(baseDocument: string, headDocument: string): OasdiffChangeType[] {
  const dir = mkdtempSync(join(tmpdir(), 'contract-check-'));
  try {
    writeFileSync(join(dir, 'base.json'), baseDocument);
    writeFileSync(join(dir, 'head.json'), headDocument);
    const output = execFileSync('docker', ['run', '--rm', '-v', `${dir}:/contract:ro`, OASDIFF_IMAGE, 'changelog', '/contract/base.json', '/contract/head.json', '--format', 'json', '--level', 'INFO'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(output || '[]') as OasdiffChangeType[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
