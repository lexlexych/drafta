"use client";

import { useEffect } from "react";

/**
 * Регистрирует сервис-воркер Serwist (`/sw.js`, собирается из `app/sw.ts`),
 * который обслуживает прекэш оболочки и Web Push
 * (docs/architecture/11-realtime-pwa.md). Монтируется один раз в оболочке
 * защищённой зоны. No-op при SSR и в браузерах без Service Worker API; в dev
 * воркер отключён (`next.config.ts` → `disable`), поэтому регистрация тоже
 * пропускается.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("[pwa] service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
