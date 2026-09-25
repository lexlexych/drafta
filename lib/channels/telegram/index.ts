import "server-only";

import { createAdminSupabaseClient } from "@/lib/db/admin";
import { getChannelConnectionSecretsByExternalId } from "@/lib/db/channel-connection-secrets";

import { registerChannelAdapter } from "../registry";
import { createTelegramAdapter, type TelegramBotCredentials } from "./adapter";

/**
 * Resolves a connected bot's credentials from `channel_connection_secrets`
 * (service-role only, decrypted in `lib/crypto/credentials.ts`). Kept in this
 * `"server-only"` module — the adapter factory itself stays a pure function of
 * its injected dependencies, the same split as `lib/channels/zernio/index.ts`.
 */
async function getTelegramBotCredentials(
  botId: string,
): Promise<TelegramBotCredentials | null> {
  const stored = await getChannelConnectionSecretsByExternalId(
    createAdminSupabaseClient(),
    "telegram",
    botId,
  );

  if (
    !stored ||
    typeof stored.botToken !== "string" ||
    typeof stored.webhookSecret !== "string"
  ) {
    return null;
  }

  return { botToken: stored.botToken, webhookSecret: stored.webhookSecret };
}

/**
 * The Telegram adapter instance the app uses. Importing this module registers
 * it under the "telegram" provider name (lib/channels/registry.ts), which is
 * also the webhook path: `/api/webhooks/telegram`.
 */
export const telegramAdapter = createTelegramAdapter({
  getCredentials: getTelegramBotCredentials,
});

registerChannelAdapter(telegramAdapter);

export {
  inspectTelegramBotToken,
  isTelegramBotTokenFormat,
  normalizeTelegramBotToken,
  registerTelegramWebhook,
} from "./connect";
