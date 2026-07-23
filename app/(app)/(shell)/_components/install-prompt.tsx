"use client";

import { useEffect, useState } from "react";

import { isIOS, isStandaloneDisplay } from "@/lib/pwa/client";

import styles from "./pwa.module.css";
import uiStyles from "./ui.module.css";

const DISMISSED_KEY = "drafta:install-dismissed";
// После отклонения не показываем предложение снова 14 дней, чтобы не надоедать.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Событие `beforeinstallprompt` (Chromium) — не в стандартных типах DOM.
 * Появляется только там, где установка поддерживается «в один клик».
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Scenario =
  | { kind: "hidden" }
  | { kind: "prompt"; event: BeforeInstallPromptEvent }
  | { kind: "ios" };

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) {
      return false;
    }
    const dismissedAt = Number.parseInt(raw, 10);
    return (
      Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_TTL_MS
    );
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Приватный режим/заблокированное хранилище — просто не запоминаем.
  }
}

/**
 * Предложение установить PWA после логина (docs/architecture/11-realtime-pwa.md,
 * этап 9). Разные сценарии под разные устройства:
 * - Chromium (Android/desktop): ловим `beforeinstallprompt` и показываем кнопку
 *   «Установить», которая вызывает нативный системный промпт;
 * - iOS Safari: `beforeinstallprompt` не существует — показываем инструкцию
 *   «Поделиться → На экран „Домой“» и предупреждаем, что push на iOS работает
 *   только для установленной PWA (iOS ≥ 16.4, §11/§17);
 * - уже установлено или недавно отклонено — ничего не показываем.
 */
export function InstallPrompt() {
  const [scenario, setScenario] = useState<Scenario>({ kind: "hidden" });

  useEffect(() => {
    if (isStandaloneDisplay() || wasRecentlyDismissed()) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      // Отменяем мини-инфобар браузера, показываем собственное предложение.
      event.preventDefault();
      setScenario({ kind: "prompt", event: event as BeforeInstallPromptEvent });
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // iOS не эмитит beforeinstallprompt — показываем инструкцию отложенно,
    // чтобы не перебивать первый экран сразу после входа.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIOS()) {
      iosTimer = setTimeout(() => {
        setScenario((current) =>
          current.kind === "hidden" ? { kind: "ios" } : current,
        );
      }, 1200);
    }

    const onInstalled = () => {
      setScenario({ kind: "hidden" });
      rememberDismissed();
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) {
        clearTimeout(iosTimer);
      }
    };
  }, []);

  if (scenario.kind === "hidden") {
    return null;
  }

  const dismiss = () => {
    rememberDismissed();
    setScenario({ kind: "hidden" });
  };

  const install = async () => {
    if (scenario.kind !== "prompt") {
      return;
    }
    try {
      await scenario.event.prompt();
      await scenario.event.userChoice;
    } catch (error) {
      console.error("[pwa] install prompt failed", error);
    } finally {
      rememberDismissed();
      setScenario({ kind: "hidden" });
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          dismiss();
        }
      }}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-prompt-title"
      >
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            d
          </span>
          <div>
            <h2 id="install-prompt-title">Установить drafta</h2>
            <p>Быстрый доступ с экрана «Домой» и push-уведомления</p>
          </div>
        </div>

        {scenario.kind === "prompt" ? (
          <>
            <p className={styles.body}>
              Установите приложение на устройство — оно откроется в отдельном
              окне, будет быстрее грузиться и сможет присылать уведомления о
              новых сообщениях.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
                onClick={dismiss}
              >
                Позже
              </button>
              <button
                type="button"
                className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
                onClick={install}
              >
                Установить
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.body}>
              Чтобы установить drafta на iPhone или iPad, добавьте приложение на
              экран «Домой»:
            </p>
            <ol className={styles.steps}>
              <li>
                Нажмите кнопку «Поделиться» <span aria-hidden="true">⎋</span> в
                панели Safari.
              </li>
              <li>Выберите «На экран „Домой“».</li>
              <li>Подтвердите — «Добавить».</li>
            </ol>
            <p className={styles.hint}>
              Push-уведомления на iOS работают только после установки на экран
              «Домой» (iOS 16.4 и новее).
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
                onClick={dismiss}
              >
                Понятно
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
