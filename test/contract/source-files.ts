import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODULES_DIR = 'src/modules';

export interface SourceFileType {
  path: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Every file under `root` whose name ends with `suffix`, read once. */
export function moduleFiles(suffix: string, root = MODULES_DIR): SourceFileType[] {
  return walk(root)
    .filter((path) => path.endsWith(suffix))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}
