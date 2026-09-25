import { timingSafeEqual } from "node:crypto";

import type { VerifyWebhookInput } from "../types";
import { botIdFromSecretToken, TELEGRAM_SECRET_HEADER } from "./secret-token";

/**
 * Telegram webhook authentication: the `X-Telegram-Bot-Api-Secret-Token`
 * header must equal the secret the bot's webhook was registered with
 * (see ./secret-token.ts). Telegram does not sign the body — the shared
 * secret over HTTPS is the whole mechanism.
 *
 * `getStoredSecret` resolves the secret saved at connect time for the bot id
 * the header names; `null` means "no such bot connected".
 */
export async function verifyTelegramSecretToken(
  input: VerifyWebhookInput,
  getStoredSecret: (botId: string) => Promise<string | null>,
): Promise<boolean> {
  const provided = input.headers[TELEGRAM_SECRET_HEADER];
  const botId = botIdFromSecretToken(provided);

  if (!provided || !botId) {
    return false;
  }

  const stored = await getStoredSecret(botId);
  if (!stored) {
    return false;
  }

  const expectedBuffer = Buffer.from(stored, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  // timingSafeEqual throws on a length mismatch; every secret we mint has the
  // same length for a given bot id, so this reveals nothing.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
