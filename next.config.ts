import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
