/**
 * Настройки частоты push (docs/architecture/11-realtime-pwa.md#частота-уведомлений--настройка-пользователя,
 * [`notification_settings`](docs/architecture/06-data-model.md#notification_settings)).
 * Валидация переиспользуется формой настроек и серверными действиями — как в
 * `lib/ai/settings.ts`.
 */

export const NOTIFICATION_MODES = ["instant", "digest"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const DIGEST_INTERVAL_MIN_MINUTES = 5;
export const DIGEST_INTERVAL_MAX_MINUTES = 1440;
export const DEFAULT_DIGEST_INTERVAL_MINUTES = 30;

export type NotificationSettingsInput = {
  mode: NotificationMode;
  digestIntervalMinutes: number;
};

export type NotificationSettingsValidationResult =
  | { ok: true; data: NotificationSettingsInput }
  | { ok: false; error: string };

export function isNotificationMode(value: unknown): value is NotificationMode {
  return (
    typeof value === "string" &&
    (NOTIFICATION_MODES as readonly string[]).includes(value)
  );
}

export function validateNotificationSettingsInput(
  input: NotificationSettingsInput,
): NotificationSettingsValidationResult {
  if (!isNotificationMode(input.mode)) {
    return { ok: false, error: "Выберите режим уведомлений." };
  }

  if (
    !Number.isInteger(input.digestIntervalMinutes) ||
    input.digestIntervalMinutes < DIGEST_INTERVAL_MIN_MINUTES ||
    input.digestIntervalMinutes > DIGEST_INTERVAL_MAX_MINUTES
  ) {
    return {
      ok: false,
      error: `Интервал дайджеста должен быть целым числом от ${DIGEST_INTERVAL_MIN_MINUTES} до ${DIGEST_INTERVAL_MAX_MINUTES} минут.`,
    };
  }

  return {
    ok: true,
    data: {
      mode: input.mode,
      digestIntervalMinutes: input.digestIntervalMinutes,
    },
  };
}
