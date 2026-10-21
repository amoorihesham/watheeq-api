import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the `@/*` path in tsconfig.json, which Vitest does not read.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/setup/global-setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 120_000,
  },
});
