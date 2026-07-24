import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Пустой turbopack-конфиг: в dev используется Turbopack (SW отключён,
   * см. `disable` ниже). @serwist/next добавляет webpack-конфиг для сборки SW,
   * из-за чего Turbopack иначе предупреждает о «потерянном» webpack-конфиге.
   * Прод-сборка SW идёт через `next build --webpack` (package.json).
   */
  turbopack: {},
};

/**
 * PWA через Serwist (docs/architecture/03-stack.md, docs/architecture/11-realtime-pwa.md).
 * Сервис-воркер компилируется из `app/sw.ts` в `public/sw.js`. В dev воркер
 * выключен, чтобы не мешать HMR. `cacheOnNavigation: false` — навигацию на
 * страницы с данными кэшировать нельзя (§11: данные всегда из сети); кэшируется
 * только оболочка (см. `runtimeCaching` в `app/sw.ts`).
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: false,
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
