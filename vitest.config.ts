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
    /*
     * Интеграционные тесты workflow-прогонов требуют плагина `@workflow/vitest`,
     * который компилирует директивы и поднимает Local World, — они запускаются
     * отдельной конфигурацией (`vitest.integration.config.ts`, `test:workflows`).
     * Здесь директивы остаются no-op, и шаги тестируются как обычные функции.
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
