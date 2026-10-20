import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../src");
const PLATFORM_MODULES = path.join(SRC, "modules", "platform") + path.sep;
const PLATFORM_TX = path.join(SRC, "db", "platform-tx.ts");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Files under `src/` that import `db/platform-tx` but are not allowed to. */
async function forbiddenPlatformTxImporters(srcFiles: string[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const file of srcFiles) {
    if (file === PLATFORM_TX || file.startsWith(PLATFORM_MODULES)) {
      continue;
    }
    const text = await readFile(file, "utf8");
    if (
      /from\s+["'][^"']*platform-tx(\.js)?["']/.test(text) ||
      /import\(\s*["'][^"']*platform-tx/.test(text)
    ) {
      offenders.push(path.relative(SRC, file));
    }
  }
  return offenders;
}

describe("architecture", () => {
  it("only src/modules/platform/ opens platform transactions (Phase 1 spec 4.1)", async () => {
    expect(await forbiddenPlatformTxImporters(await sourceFiles(SRC))).toEqual([]);
  });

  it("flags a planted import outside src/modules/platform/", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wq-arch-"));
    try {
      const planted = path.join(dir, "tenant-feature.service.ts");
      await writeFile(planted, 'import { withPlatformTx } from "../../db/platform-tx.js";\n');
      expect(await forbiddenPlatformTxImporters([planted])).toEqual([path.relative(SRC, planted)]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
