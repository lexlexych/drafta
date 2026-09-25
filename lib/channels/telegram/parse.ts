import type {
  NormalizedAttachment,
  NormalizedEvent,
  ParseWebhookInput,
  ParseWebhookResult,
  UnparsedEnvelope,
} from "../types";
import { botIdFromSecretToken, TELEGRAM_SECRET_HEADER } from "./secret-token";

/**
 * Normalizes one Telegram Bot API `Update`
 * (https://core.telegram.org/bots/api#update) into drafta's events.
 *
 * Scope (docs/architecture/05-channels.md#telegram-напрямую-bot-api):
 * - only `message` in a **private** chat becomes an event — `message.received`;
 *   the webhook is registered with `allowed_updates: ["message"]`, so other
 *   update kinds should not arrive at all;
 * - messages from groups, supergroups and channels the bot was added to are
 *   dropped *without* journaling: they come from people who never wrote to the
 *   business, and keeping their texts would contradict data minimization;
 * - any other update kind is refused into `unparsed` and journaled, like every
 *   adapter does with what it cannot map.
 *
 * Attachments are metadata only, **never a URL**: a Bot API file URL embeds
 * the bot token (`/file/bot<token>/…`), and storing one would leak it.
 *
 * `update_id` is unique per bot only, while `webhook_events` is unique on
 * (provider, external_event_id) — so the event id is `<botId>:<update_id>`.
 */

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

interface TelegramFileBase {
  file_id?: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
}

interface TelegramMessage {
  message_id: number;
  date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramFileBase[];
  document?: TelegramFileBase;
  video?: TelegramFileBase;
  video_note?: TelegramFileBase;
  animation?: TelegramFileBase;
  audio?: TelegramFileBase;
  voice?: TelegramFileBase;
  sticker?: TelegramFileBase & { emoji?: string };
  location?: unknown;
  contact?: unknown;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  [key: string]: unknown;
}

export function parseTelegramWebhook(input: ParseWebhookInput): ParseWebhookResult {
  const botId = botIdFromSecretToken(input.headers[TELEGRAM_SECRET_HEADER]);
  if (!botId) {
    // verifyWebhook already rejects this; reaching here is a caller bug.
    throw new Error("Telegram webhook is missing a valid secret token header.");
  }

  const update = JSON.parse(input.rawBody) as unknown;
  if (!isObject(update) || typeof update.update_id !== "number") {
    return {
      events: [],
      unparsed: [refuse(null, botId, update, "Update has no numeric update_id.")],
    };
  }

  const typed = update as TelegramUpdate;
  const providerEventId = `${botId}:${typed.update_id}`;
  const message = typed.message;

  if (!message) {
    const kind = Object.keys(typed).find((key) => key !== "update_id") ?? "empty";
    return {
      events: [],
      unparsed: [
        refuse(providerEventId, botId, typed, `Unsupported Telegram update kind "${kind}".`),
      ],
    };
  }

  if (!isObject(message.chat) || typeof message.message_id !== "number") {
    return {
      events: [],
      unparsed: [refuse(providerEventId, botId, typed, "Message has no chat or message_id.")],
    };
  }

  if (message.chat.type !== "private") {
    return { events: [], unparsed: [] };
  }

  const from = message.from;
  if (!from || typeof from.id !== "number") {
    return {
      events: [],
      unparsed: [refuse(providerEventId, botId, typed, "Private message has no sender.")],
    };
  }

  const event: NormalizedEvent = {
    type: "message.received",
    providerEventId,
    provider: "telegram",
    platform: "telegram",
    externalAccountId: botId,
    conversation: { externalId: String(message.chat.id) },
    message: {
      externalId: String(message.message_id),
      text: message.text ?? message.caption ?? "",
      attachments: mapAttachments(message),
      sender: {
        externalId: String(from.id),
        ...optionalDisplayName(from),
      },
    },
    rawMetadata: typed as unknown as Record<string, unknown>,
  };

  return { events: [event], unparsed: [] };
}

function mapAttachments(message: TelegramMessage): NormalizedAttachment[] {
  const attachments: NormalizedAttachment[] = [];

  if (message.photo && message.photo.length > 0) {
    attachments.push({ type: "image" });
  }

  const files: Array<[string, TelegramFileBase | undefined]> = [
    ["file", message.document],
    ["video", message.video],
    ["video", message.video_note],
    ["video", message.animation],
    ["audio", message.audio],
    ["audio", message.voice],
    ["sticker", message.sticker],
  ];

  for (const [type, file] of files) {
    if (!file) continue;
    attachments.push({
      type,
      ...(file.file_name ? { fileName: file.file_name } : {}),
      ...(file.mime_type ? { mimeType: file.mime_type } : {}),
    });
  }

  if (message.location) attachments.push({ type: "location" });
  if (message.contact) attachments.push({ type: "contact" });

  return attachments;
}

function optionalDisplayName(user: TelegramUser): { displayName?: string } {
  const fullName = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const displayName = fullName || (user.username ? `@${user.username}` : "");

  return displayName ? { displayName } : {};
}

function refuse(
  providerEventId: string | null,
  botId: string,
  raw: unknown,
  reason: string,
): UnparsedEnvelope {
  return {
    providerEventId,
    externalAccountId: botId,
    reason,
    rawEnvelope: isObject(raw) ? raw : { value: raw },
    platform: "telegram",
    participantHandles: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
