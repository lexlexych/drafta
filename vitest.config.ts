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
    setupFiles: ["./tests/support/setup.ts"],
    // Лимит теста должен быть заметно больше, чем ожидание внутри него
    // (`asyncUtilTimeout` в setup — 5 с). Иначе тест умирает раньше, чем
    // ожидание успеет сказать, чего именно оно не дождалось, и вместо
    // «не нашёл такую-то кнопку» в отчёте остаётся бесполезное
    // «Test timed out». Это потолок, а не задержка: быстрые тесты быстрее
    // не станут, но и не упрутся в него на загруженной машине.
    testTimeout: 20_000,
  },
});
