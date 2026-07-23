import type { MetadataRoute } from "next";

import { appDescription, appName } from "@/lib/app-metadata";

/**
 * Web App Manifest (docs/architecture/11-realtime-pwa.md). Делает drafta
 * устанавливаемым PWA: на десктопе/Android — кнопка установки, на iOS —
 * «На экран „Домой“» (после чего работает Web Push, iOS ≥ 16.4). Цвета — из
 * бренд-палитры `app/globals.css` (`--accent`, `--bg`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appName,
    short_name: appName,
    description: appDescription,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "de",
    dir: "ltr",
    background_color: "#f5f6f3",
    theme_color: "#0e7a6b",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
