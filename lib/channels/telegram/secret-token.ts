import { randomBytes } from "node:crypto";

/**
 * The webhook secret a bot's `setWebhook` is registered with — Telegram sends
 * it back on every update in the `X-Telegram-Bot-Api-Secret-Token` header.
 *
 * A Telegram update carries no bot id, yet the core resolves a connection by
 * (provider, externalAccountId). So the secret is `<botId>_<random>`: the
 * bot id prefix tells the adapter which bot an update is for without a
 * database lookup, and the random part (compared in constant time against the
 * stored copy) is what actually authenticates the request. Telegram allows
 * 1–256 characters from `A-Z a-z 0-9 _ -`; base64url fits.
 */

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function createTelegramWebhookSecret(botId: string): string {
  return `${botId}_${randomBytes(32).toString("base64url")}`;
}

/** The bot id encoded in a secret token header, or `null` if the header is not one of ours. */
export function botIdFromSecretToken(secretToken: string | undefined): string | null {
  if (!secretToken) {
    return null;
  }

  const match = /^(\d+)_[A-Za-z0-9_-]+$/.exec(secretToken);
  return match ? match[1] : null;
}
