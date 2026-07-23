"use client";

import { useEffect, useState } from "react";

import { isIOS, isStandaloneDisplay } from "@/lib/pwa/client";
import {
  isInstallAvailable,
  promptInstall,
  subscribeInstallAvailability,
} from "@/lib/pwa/install-store";

import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";

type InstallState = "loading" | "installed" | "available" | "ios" | "unavailable";

function detectState(): InstallState {
  if (isStandaloneDisplay()) {
    return "installed";
  }
  if (isInstallAvailable()) {
    return "available";
  }
  if (isIOS()) {
    return "ios";
  }
  return "unavailable";
}

/**
 * Панель раздела «Приложение» (docs/architecture/11-realtime-pwa.md, этап 9):
 * ручная установка PWA на устройство. Кнопка «Установить на устройство» доступна
 * там, где Chromium перехватил `beforeinstallprompt` (см. `lib/pwa/install-store.ts`);
 * на iOS показываем инструкцию для Safari; в остальных случаях — подсказку про
 * меню браузера (в т.ч. когда установка ещё не предложена или это dev-сборка без
 * сервис-воркера).
 */
export function AppInstallPanel() {
  const [state, setState] = useState<InstallState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Определяем состояние только на клиенте (нужен `window`); событие установки
    // могло прийти и позже монтирования — переоцениваем по подписке.
    const evaluate = () => setState(detectState());
    evaluate();
    const unsubscribe = subscribeInstallAvailability(evaluate);
    return unsubscribe;
  }, []);

  async function install() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        setState("installed");
      } else {
        setState(detectState());
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "installed") {
    return (
      <div className={uiStyles.card}>
        <h3>Приложение установлено</h3>
        <p className={styles.description}>
          drafta открыта как установленное приложение на этом устройстве.
        </p>
      </div>
    );
  }

  if (state === "ios") {
    return (
      <div className={`${uiStyles.card} ${uiStyles.cardStack}`}>
        <h3>Установка на iPhone или iPad</h3>
        <p className={styles.description}>
          Чтобы добавить drafta на экран «Домой» в Safari:
        </p>
        <ol className={styles.description} style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            Нажмите кнопку «Поделиться» <span aria-hidden="true">⎋</span> в панели
            Safari.
          </li>
          <li>Выберите «На экран „Домой“».</li>
          <li>Подтвердите — «Добавить».</li>
        </ol>
        <p className={styles.fieldHint}>
          Push-уведомления на iOS работают только после установки на экран «Домой»
          (iOS 16.4 и новее).
        </p>
      </div>
    );
  }

  return (
    <div className={`${uiStyles.card} ${uiStyles.cardStack}`}>
      <h3>Установить на устройство</h3>
      <p className={styles.description}>
        Установленное приложение открывается в отдельном окне, быстрее грузится и
        может присылать push-уведомления о новых сообщениях.
      </p>
      <button
        type="button"
        className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
        onClick={install}
        disabled={busy || state !== "available"}
      >
        {busy ? "Установка…" : "Установить на устройство"}
      </button>
      {state !== "available" ? (
        <p className={styles.fieldHint}>
          Если кнопка недоступна, установку можно запустить из меню браузера —
          пункт «Установить приложение» (или значок установки в адресной строке).
        </p>
      ) : null}
    </div>
  );
}
