import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const MODULES_DIR = "src/modules";

export interface SourceFileType {
  path: string;
  /** The folder directly under `src/modules` that holds the file. */
  module: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function moduleFolders(root = MODULES_DIR): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Every file under `root` whose name ends with `suffix`, read once, with its module folder. */
export function moduleFiles(suffix: string, root = MODULES_DIR): SourceFileType[] {
  return walk(root)
    .filter((path) => path.endsWith(suffix))
    .map((path) => ({
      path,
      module: relative(root, path).split(sep)[0] ?? "",
      text: readFileSync(path, "utf8"),
    }));
}
