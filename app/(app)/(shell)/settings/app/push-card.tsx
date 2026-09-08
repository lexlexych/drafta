"use client";

/**
 * Push на этом устройстве — карточка раздела «Приложение»
 * (docs/architecture/11-realtime-pwa.md#web-push).
 *
 * Живёт рядом с установкой PWA, потому что push и установка — одна история
 * одного устройства: на iOS push вообще не работает до установки на «Домой».
 * Частоты уведомлений здесь нет: push приходит на каждое входящее, других
 * режимов у контура нет.
 */

import { useEffect, useState } from "react";

import {
  isIOS,
  isPushSupported,
  isStandaloneDisplay,
  urlBase64ToUint8Array,
} from "@/lib/pwa/client";

import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
} from "./actions";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type PushState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "subscribed"
  | "unsubscribed";

export function PushCard() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!isPushSupported()) {
        // На iOS push доступен только у установленной PWA (§11).
        setState(
          isIOS() && !isStandaloneDisplay() ? "needs-install" : "unsupported",
        );
        return;
      }
      if (!VAPID_PUBLIC_KEY) {
        setState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) {
          return;
        }
        setState(subscription ? "subscribed" : "unsubscribed");
      } catch {
        if (!cancelled) {
          setState("unsupported");
        }
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh;
      const authKey = json.keys?.auth;
      if (!json.endpoint || !p256dh || !authKey) {
        throw new Error("subscription is missing keys");
      }

      const result = await savePushSubscriptionAction({
        endpoint: json.endpoint,
        p256dh,
        authKey,
      });
      if (!result.ok) {
        // Не оставляем висящую подписку без записи на сервере.
        await subscription.unsubscribe().catch(() => undefined);
        setError(result.error);
        setState("unsubscribed");
        return;
      }
      setState("subscribed");
    } catch (caught) {
      console.error("[push] enable failed", caught);
      setError("Не удалось включить push-уведомления.");
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe().catch(() => undefined);
      }
      setState("unsubscribed");
    } catch (caught) {
      console.error("[push] disable failed", caught);
      setError("Не удалось отключить push-уведомления.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={uiStyles.card}>
      <h3>Push на этом устройстве</h3>
      <div className={styles.toggleRow}>
        <div className={styles.toggleLabel}>
          Push-уведомления
          <span>{describePushState(state)}</span>
          {error ? (
            <span className={styles.formError} role="alert">
              {error}
            </span>
          ) : null}
        </div>
        {state === "subscribed" ? (
          <button
            type="button"
            className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonSmall}`}
            onClick={disablePush}
            disabled={busy}
          >
            {busy ? "…" : "Отключить"}
          </button>
        ) : state === "unsubscribed" ? (
          <button
            type="button"
            className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
            onClick={enablePush}
            disabled={busy}
          >
            {busy ? "…" : "Включить"}
          </button>
        ) : null}
      </div>
      <p className={styles.fieldHint}>
        Push приходит на каждое новое входящее — в нём только имя, канал и
        ссылка на диалог, без текста сообщения.
      </p>
    </div>
  );
}

function describePushState(state: PushState): string {
  switch (state) {
    case "loading":
      return "Проверяем поддержку…";
    case "unsupported":
      return "Браузер не поддерживает push-уведомления.";
    case "needs-install":
      return "Установите приложение на экран «Домой» — тогда push заработает (iOS 16.4+).";
    case "unconfigured":
      return "Push пока не настроен на сервере (нет VAPID-ключа).";
    case "denied":
      return "Разрешение на уведомления заблокировано в настройках браузера.";
    case "subscribed":
      return "Включены на этом устройстве.";
    case "unsubscribed":
      return "Выключены на этом устройстве.";
  }
}
