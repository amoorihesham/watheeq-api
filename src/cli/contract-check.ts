import { parseArgs } from 'node:util';
import { classify, documentAt, type GroupedChangeType, OPENAPI_FILE, oasdiffChangelog, parseTrailers, TRAILER_KEY, trailersBetween } from './contract-changes.js';

const USAGE = `Usage: pnpm contract:check [--base <revision>] [--head <revision>]
Compares ${OPENAPI_FILE} at --base (default origin/dev) with --head (default: the working tree).
A contract change needs a "${TRAILER_KEY}: amoorihesham/watheeq-frontend#<n>" trailer in a commit after --base
(docs/FRONTEND_COLLABORATION.md, section 5). Needs Docker.`;

let options: { base: string; head: string | undefined };
try {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'origin/dev' }, head: { type: 'string' } } });
  options = { base: values.base, head: values.head };
} catch {
  console.error(USAGE);
  process.exit(2);
}

function print(title: string, changes: GroupedChangeType[]) {
  console.log(`\n${title}:`);
  for (const { text, operations } of changes) {
    console.log(`  - ${text}`);
    console.log(`    in ${operations.length > 3 ? `${operations.slice(0, 3).join(', ')} and ${operations.length - 3} more` : operations.join(', ') || 'the document'}`);
  }
}

try {
  const { contractChanges, additions, newCodes } = classify(oasdiffChangelog(documentAt(options.base), documentAt(options.head)));
  const { issues, malformed } = parseTrailers(trailersBetween(options.base, options.head ?? 'HEAD'));

  if (additions.length > 0) {
    print('Additions (for the be:heads-up issue)', additions);
  }
  if (newCodes.length > 0) {
    console.log(`\nNew error or detail codes (for the be:heads-up issue): ${newCodes.join(', ')}`);
  }
  if (contractChanges.length > 0) {
    print('Contract changes', contractChanges);
  }
  for (const value of malformed) {
    console.error(`\n${TRAILER_KEY} trailer "${value}" is not amoorihesham/watheeq-frontend#<n>.`);
  }

  if (contractChanges.length > 0 && issues.length === 0) {
    console.error(`\nThe contract changes since ${options.base} have no be:contract-change issue.`);
    console.error('File one on amoorihesham/watheeq-frontend from its contract-change template, then name it in a commit trailer:');
    console.error(`  ${TRAILER_KEY}: amoorihesham/watheeq-frontend#<n>`);
    process.exit(1);
  }
  if (malformed.length > 0) {
    process.exit(1);
  }
  console.log(contractChanges.length > 0 ? `\nAnnounced in ${issues.join(', ')}.` : `\nNo contract changes since ${options.base}.`);
} catch (err) {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  console.error(`contract check failed: ${stderr || (err as Error).message}`);
  process.exit(2);
}
