import { fileURLToPath } from "node:url";

import { workflow } from "@workflow/vitest";
import { defineConfig } from "vitest/config";

/**
 * Интеграционные тесты workflow-прогонов (docs/architecture/18-workflows.md).
 * Плагин компилирует директивы `"use workflow"` / `"use step"` и поднимает
 * Local World в процессе теста, поэтому такие тесты живут отдельно от юнитов:
 * без плагина директивы — no-op, и шаги тестируются как обычные функции.
 */
export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    testTimeout: 60_000,
  },
});
