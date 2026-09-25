import type {
  ChannelAdapter,
  DisconnectAccountInput,
  ParseWebhookInput,
  ParseWebhookResult,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
} from "../types";
import {
  deleteWebhook,
  sendTextMessage,
  TelegramApiError,
  type TelegramApiOptions,
} from "./api";
import { parseTelegramWebhook } from "./parse";
import { verifyTelegramSecretToken } from "./verify";

const PROVIDER = "telegram" as const;

/** What drafta keeps for one connected bot — encrypted at rest. */
export interface TelegramBotCredentials {
  botToken: string;
  webhookSecret: string;
}

export interface TelegramAdapterDependencies {
  /**
   * Resolves the stored credentials of a connected bot by its id
   * (`channel_connections.external_id`), or `null` when none is connected.
   * Injected so this factory never touches the database or the environment
   * (vibecoding rule 4: adapters do not read the DB) — the wiring lives in
   * `./index.ts`.
   */
  getCredentials(botId: string): Promise<TelegramBotCredentials | null>;
  api?: TelegramApiOptions;
}

/**
 * The direct Telegram Bot API `ChannelAdapter`
 * (docs/architecture/05-channels.md#telegram-напрямую-bot-api).
 *
 * Connecting is not part of the adapter interface: there is no OAuth
 * redirect, the user pastes a bot token instead (`./connect.ts`).
 */
export function createTelegramAdapter(
  dependencies: TelegramAdapterDependencies,
): ChannelAdapter {
  return {
    provider: PROVIDER,

    verifyWebhook(input: VerifyWebhookInput): Promise<boolean> {
      return verifyTelegramSecretToken(input, async (botId) => {
        const credentials = await dependencies.getCredentials(botId);
        return credentials?.webhookSecret ?? null;
      });
    },

    parseWebhook(input: ParseWebhookInput): ParseWebhookResult {
      return parseTelegramWebhook(input);
    },

    async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
      if (input.interactionKind === "comment") {
        throw new TelegramApiError("Telegram bots have no comments.", 400);
      }

      const credentials = await dependencies.getCredentials(input.externalAccountId);
      if (!credentials) {
        // No token — the connection lost its secrets; retrying cannot help.
        throw new TelegramApiError("Telegram bot credentials are missing.", 401);
      }

      const sent = await sendTextMessage(
        credentials.botToken,
        { chatId: input.conversationExternalId, text: input.text },
        dependencies.api,
      );

      return { providerMessageId: String(sent.message_id) };
    },

    /**
     * Removes the bot's webhook so Telegram stops delivering updates.
     * Idempotent: a bot without stored credentials, or whose token was
     * already revoked (401), has nothing left to disconnect.
     */
    async disconnectAccount(input: DisconnectAccountInput): Promise<void> {
      const credentials = await dependencies.getCredentials(input.externalAccountId);
      if (!credentials) {
        return;
      }

      try {
        await deleteWebhook(credentials.botToken, dependencies.api);
      } catch (error) {
        if (error instanceof TelegramApiError && error.status === 401) {
          return;
        }
        throw error;
      }
    },
  };
}
