/**
 * Общий стор доступности установки PWA (docs/architecture/11-realtime-pwa.md).
 *
 * Проблема: Chromium эмитит `beforeinstallprompt` очень рано — обычно **до** того,
 * как смонтируется React и повесит слушатель в `useEffect`. Одноразовое событие
 * теряется, и всплывашка не появляется. Решение: ранний inline-скрипт в `<head>`
 * (`app/layout.tsx`) ловит событие ещё до гидратации и кладёт его в
 * `window.__draftaInstall`, а этот модуль даёт к нему типобезопасный доступ и
 * подписку. Так и авто-предложение (`InstallPrompt`), и кнопка в настройках
 * читают одно и то же состояние.
 */

/** `beforeinstallprompt` — нестандартное событие Chromium, нет в типах DOM. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallGlobal = { event: BeforeInstallPromptEvent | null };

declare global {
  interface Window {
    __draftaInstall?: InstallGlobal;
  }
}

/** Событие, которое ранний head-скрипт эмитит при захвате `beforeinstallprompt`. */
export const INSTALL_AVAILABLE_EVENT = "drafta:installavailable";
/** Событие, которое ранний head-скрипт эмитит при `appinstalled`. */
export const INSTALLED_EVENT = "drafta:installed";

export function getDeferredInstallEvent(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.__draftaInstall?.event ?? null;
}

/** Доступна ли установка «в один клик» (Chromium перехватил `beforeinstallprompt`). */
export function isInstallAvailable(): boolean {
  return getDeferredInstallEvent() !== null;
}

export type PromptInstallResult = "accepted" | "dismissed" | "unavailable";

/**
 * Показывает нативный системный промпт установки. Событие одноразовое —
 * после `prompt()` оно израсходовано, поэтому обнуляем стор и уведомляем
 * подписчиков, чтобы кнопки перерисовались.
 */
export async function promptInstall(): Promise<PromptInstallResult> {
  const deferred = getDeferredInstallEvent();
  if (!deferred) {
    return "unavailable";
  }
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    return choice.outcome;
  } finally {
    if (window.__draftaInstall) {
      window.__draftaInstall.event = null;
    }
    window.dispatchEvent(new Event(INSTALL_AVAILABLE_EVENT));
  }
}

/** Подписка на изменения доступности установки (захват события или установка). */
export function subscribeInstallAvailability(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(INSTALL_AVAILABLE_EVENT, callback);
  window.addEventListener(INSTALLED_EVENT, callback);
  return () => {
    window.removeEventListener(INSTALL_AVAILABLE_EVENT, callback);
    window.removeEventListener(INSTALLED_EVENT, callback);
  };
}
