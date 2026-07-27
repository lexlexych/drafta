"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  isIOS,
  isPushSupported,
  isStandaloneDisplay,
  urlBase64ToUint8Array,
} from "@/lib/pwa/client";
import {
  DIGEST_INTERVAL_MAX_MINUTES,
  DIGEST_INTERVAL_MIN_MINUTES,
  validateNotificationSettingsInput,
  type NotificationSettingsInput,
} from "@/lib/notifications/settings";

import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  saveNotificationSettingsAction,
} from "./actions";
import { useActivityTransition } from "../../_components/activity";

export type NotificationsFormValue = NotificationSettingsInput;

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type PushState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "subscribed"
  | "unsubscribed";

export function NotificationsForm({
  initialValue,
}: {
  initialValue: NotificationsFormValue;
}) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useActivityTransition("Сохраняем настройки…");

  const [pushState, setPushState] = useState<PushState>("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const isDirty = JSON.stringify(value) !== JSON.stringify(savedValue);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!isPushSupported()) {
        // На iOS push доступен только у установленной PWA (§11).
        setPushState(
          isIOS() && !isStandaloneDisplay() ? "needs-install" : "unsupported",
        );
        return;
      }
      if (!VAPID_PUBLIC_KEY) {
        setPushState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        setPushState("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) {
          return;
        }
        setPushState(subscription ? "subscribed" : "unsubscribed");
      } catch {
        if (!cancelled) {
          setPushState("unsupported");
        }
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof NotificationsFormValue>(
    key: K,
    next: NotificationsFormValue[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
    setError(null);
    setSaved(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateNotificationSettingsInput(value);
    if (!validation.ok) {
      setSaved(false);
      setError(validation.error);
      return;
    }

    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveNotificationSettingsAction(validation.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const persisted: NotificationsFormValue = {
        mode: result.data.mode,
        digestIntervalMinutes: result.data.digestIntervalMinutes,
      };
      setValue(persisted);
      setSavedValue(persisted);
      setSaved(true);
    });
  }

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) {
      return;
    }
    setPushBusy(true);
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "unsubscribed");
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
        setPushError(result.error);
        setPushState("unsubscribed");
        return;
      }
      setPushState("subscribed");
    } catch (caught) {
      console.error("[push] enable failed", caught);
      setPushError("Не удалось включить push-уведомления.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe().catch(() => undefined);
      }
      setPushState("unsubscribed");
    } catch (caught) {
      console.error("[push] disable failed", caught);
      setPushError("Не удалось отключить push-уведомления.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <form className={styles.aiForm} onSubmit={handleSubmit}>
      <div className={uiStyles.card}>
        <h3>Push на этом устройстве</h3>
        <PushControl
          state={pushState}
          busy={pushBusy}
          error={pushError}
          onEnable={enablePush}
          onDisable={disablePush}
        />
      </div>

      <div className={`${uiStyles.card} ${uiStyles.cardStack}`}>
        <h3>Частота уведомлений</h3>
        <label className={uiStyles.radioRow}>
          <input
            type="radio"
            name="notification-mode"
            checked={value.mode === "instant"}
            onChange={() => update("mode", "instant")}
            disabled={isPending}
          />
          На каждое входящее
        </label>
        <label className={uiStyles.radioRow}>
          <input
            type="radio"
            name="notification-mode"
            checked={value.mode === "digest"}
            onChange={() => update("mode", "digest")}
            disabled={isPending}
          />
          Дайджест с интервалом
        </label>

        {value.mode === "digest" ? (
          <div className={uiStyles.field}>
            <label htmlFor="digest-interval">Интервал сводки</label>
            <div className={styles.aiDebounceField}>
              <input
                id="digest-interval"
                type="number"
                min={DIGEST_INTERVAL_MIN_MINUTES}
                max={DIGEST_INTERVAL_MAX_MINUTES}
                step={1}
                value={value.digestIntervalMinutes}
                onChange={(event) =>
                  update("digestIntervalMinutes", event.target.valueAsNumber)
                }
                disabled={isPending}
              />
              <span>минут</span>
            </div>
            <span className={styles.fieldHint}>
              Целое число от {DIGEST_INTERVAL_MIN_MINUTES} до{" "}
              {DIGEST_INTERVAL_MAX_MINUTES}. В режиме дайджеста приходит сводка о
              новых входящих; мгновенные push не приходят.
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.aiFormFooter}>
        <div className={styles.aiFormState} aria-live="polite">
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : saved ? (
            <p className={styles.formSuccess} role="status">
              Настройки сохранены.
            </p>
          ) : isDirty ? (
            <p>Есть несохранённые изменения.</p>
          ) : null}
        </div>
        <button
          type="submit"
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          disabled={isPending || !isDirty}
        >
          {isPending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

function PushControl({
  state,
  busy,
  error,
  onEnable,
  onDisable,
}: {
  state: PushState;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
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
          onClick={onDisable}
          disabled={busy}
        >
          {busy ? "…" : "Отключить"}
        </button>
      ) : state === "unsubscribed" ? (
        <button
          type="button"
          className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
          onClick={onEnable}
          disabled={busy}
        >
          {busy ? "…" : "Включить"}
        </button>
      ) : null}
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
