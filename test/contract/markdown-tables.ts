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

/** The text of `.API.md` files of every phase folder under `docs/specs`. */
export function apiDocs(root = "docs/specs"): { path: string; text: string }[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) =>
      readdirSync(join(root, folder.name))
        .filter((name) => name.endsWith(".API.md"))
        .map((name) => {
          const path = join(root, folder.name, name);
          return { path, text: readFileSync(path, "utf8") };
        }),
    );
}
