import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Serwist service worker output (see next.config.ts / app/sw.ts).
    "public/sw.js",
    "public/sw.js.map",
    "public/swe-worker-*.js",
    // Локальное состояние Supabase CLI (`supabase start`): чужой генерированный
    // код под Deno, который иначе роняет `npm run lint` на каждой машине с
    // поднятым локальным стеком. В git не попадает — supabase/.gitignore.
    "supabase/.temp/**",
    // Артефакты Workflow SDK: служебные роуты, которые `withWorkflow` генерирует
    // при сборке, бандлы плагина `@workflow/vitest` и состояние Local World.
    // Всё генерированное, в git не попадает (.gitignore).
    "app/.well-known/workflow/**",
    ".workflow-vitest/**",
    ".workflow-data/**",
  ]),
]);

export default eslintConfig;
