import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The cells of one table row, trimmed; `\|` inside a cell is kept as a pipe. */
export function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

/** Every table row of a Markdown text, without the header and separator rows. */
export function tableRows(text: string): string[][] {
  const rows: string[][] = [];
  let header = false;
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) {
      header = false;
      continue;
    }
    if (!header) {
      header = true;
      continue;
    }
    if (/^\|[\s:|-]+\|?$/.test(line.trim())) {
      continue;
    }
    rows.push(cellsOf(line));
  }
  return rows;
}

const IMPLEMENTED_STATUSES = ["In Implementation", "Implemented"];

/** The value of the `| **Status** |` row of a phase spec, or undefined when there is none. */
export function specStatus(specText: string): string | undefined {
  const row = specText.split("\n").find((line) => /^\|\s*\*\*Status\*\*\s*\|/.test(line));
  return row === undefined ? undefined : cellsOf(row)[1];
}

/** Only specs in implementation or implemented have mounted routes for their tables to match (Phase 10, Q15). */
export function hasMountedRoutes(specText: string): boolean {
  return IMPLEMENTED_STATUSES.includes(specStatus(specText) ?? "");
}

/** The text of `.API.md` files of every phase folder under `docs/specs` whose sibling spec is In Implementation or Implemented. */
export function apiDocs(root = "docs/specs"): { path: string; text: string }[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) => {
      const names = readdirSync(join(root, folder.name));
      const spec = names.find((name) => name.endsWith(".md") && !name.endsWith(".API.md"));
      if (
        spec === undefined ||
        !hasMountedRoutes(readFileSync(join(root, folder.name, spec), "utf8"))
      ) {
        return [];
      }
      return names
        .filter((name) => name.endsWith(".API.md"))
        .map((name) => {
          const path = join(root, folder.name, name);
          return { path, text: readFileSync(path, "utf8") };
        });
    });
}
