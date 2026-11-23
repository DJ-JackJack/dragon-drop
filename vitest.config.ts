import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts", "apps/editor/test/**/*.test.ts", "apps/desktop/test/**/*.test.mjs"],
    testTimeout: 30000,
  },
});
