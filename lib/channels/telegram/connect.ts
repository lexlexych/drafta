import { getMe, setWebhook, TelegramApiError, type TelegramApiOptions } from "./api";
import { createTelegramWebhookSecret } from "./secret-token";

/**
 * Connecting a Telegram bot by token (docs/architecture/05-channels.md#telegram-напрямую-bot-api).
 *
 * Two steps, split so the caller can persist the connection in between:
 * 1. `inspectTelegramBotToken` — validates the token with `getMe` and mints
 *    the webhook secret. Nothing changes at Telegram yet.
 * 2. `registerTelegramWebhook` — points the bot's webhook at drafta. Done
 *    only after the connection and its secret are stored, so no update can
 *    arrive that drafta could not authenticate.
 */

/** Updates drafta asks for — private messages only; everything else stays at Telegram. */
export const TELEGRAM_ALLOWED_UPDATES = ["message"];

const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export type InspectTelegramBotResult =
  | { ok: true; botId: string; username: string; webhookSecret: string }
  | { ok: false; reason: "invalid-format" | "invalid-token" | "not-a-bot" | "network" };

export function normalizeTelegramBotToken(value: string): string {
  return value.trim();
}

export function isTelegramBotTokenFormat(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export async function inspectTelegramBotToken(
  token: string,
  options?: TelegramApiOptions,
): Promise<InspectTelegramBotResult> {
  if (!isTelegramBotTokenFormat(token)) {
    return { ok: false, reason: "invalid-format" };
  }

  let bot;
  try {
    bot = await getMe(token, options);
  } catch (error) {
    if (error instanceof TelegramApiError && error.status === 401) {
      return { ok: false, reason: "invalid-token" };
    }
    if (error instanceof TelegramApiError && error.status === 404) {
      // Telegram answers 404 for a token that does not exist at all.
      return { ok: false, reason: "invalid-token" };
    }
    return { ok: false, reason: "network" };
  }

  if (!bot.is_bot) {
    return { ok: false, reason: "not-a-bot" };
  }

  const botId = String(bot.id);
  return {
    ok: true,
    botId,
    username: bot.username ?? bot.first_name,
    webhookSecret: createTelegramWebhookSecret(botId),
  };
}

export async function registerTelegramWebhook(
  token: string,
  params: { url: string; webhookSecret: string },
  options?: TelegramApiOptions,
): Promise<void> {
  await setWebhook(
    token,
    {
      url: params.url,
      secretToken: params.webhookSecret,
      allowedUpdates: TELEGRAM_ALLOWED_UPDATES,
      // Anything queued for a previous webhook/polling setup belongs to
      // whatever used the bot before drafta.
      dropPendingUpdates: true,
    },
    options,
  );
}
