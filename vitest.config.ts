import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/setup/global-setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 120_000,
  },
});
