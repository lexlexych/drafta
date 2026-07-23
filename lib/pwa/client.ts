/**
 * Клиентские хелперы PWA (docs/architecture/11-realtime-pwa.md). Только для
 * браузера — все обращения к `window`/`navigator` защищены проверками, чтобы
 * модуль безопасно импортировался в компонентах, рендерящихся и на сервере.
 */

/** Приложение открыто как установленное PWA (standalone), а не во вкладке. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    iosStandalone === true
  );
}

/** iOS/iPadOS Safari — там нет `beforeinstallprompt`, установка только вручную. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ мимикрирует под Mac — распознаём по тач-поинтам.
  const iPadOS =
    navigator.platform === "MacIntel" &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints !==
      undefined &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return iOSDevice || iPadOS;
}

/** Браузер умеет Web Push (Service Worker + Push API + Notification API). */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Конвертирует URL-safe base64 VAPID-ключ в `Uint8Array` для
 * `pushManager.subscribe({ applicationServerKey })`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  // Explicit ArrayBuffer backing so the result is a BufferSource accepted by
  // `pushManager.subscribe({ applicationServerKey })` under strict lib types.
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
