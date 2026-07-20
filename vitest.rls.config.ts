import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: ["tests/rls/**/*.integration.ts"],
    setupFiles: ["./tests/rls/setup.ts"],
    testTimeout: 30_000,
  },
});
