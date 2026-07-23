import "server-only";

import webpush from "web-push";

/**
 * Обёртка над библиотекой `web-push` (docs/architecture/11-realtime-pwa.md#web-push).
 * VAPID-ключи — серверные секреты (`VAPID_PRIVATE_KEY` только на сервере,
 * vibecoding rule 5); публичный ключ дублируется в `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 * для браузера. Отправка идёт только из Inngest-функций `send-push`/`push-digest`
 * (rule 8), не из запросов.
 */

export type WebPushTarget = {
  endpoint: string;
  p256dh: string;
  authKey: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

export type WebPushSendResult =
  | { status: "sent" }
  | { status: "expired" }
  | { status: "error"; message: string };

let configured = false;

function ensureConfigured(): void {
  if (configured) {
    return;
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "Missing VAPID keys: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
  }

  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@drafta.app";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** Push-конфигурация присутствует (ключи заданы) — можно вообще пытаться слать. */
export function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Отправляет один push. `expired` (404/410) — подписка мертва, её нужно удалить
 * (см. `pruneSubscription`). Прочие ошибки возвращаются как `error`, чтобы
 * вызывающая Inngest-функция решила про ретрай.
 */
export async function sendWebPush(
  target: WebPushTarget,
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  ensureConfigured();

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.authKey },
      },
      JSON.stringify(payload),
    );
    return { status: "sent" };
  } catch (error) {
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { status: "expired" };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "web-push failed",
    };
  }
}
