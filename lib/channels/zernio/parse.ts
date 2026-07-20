import type {
  ChannelPlatform,
  NormalizedAttachment,
  NormalizedEvent,
  NormalizedEventType,
  ParseWebhookInput,
} from "../types";

/**
 * Raw Zernio webhook envelope — this adapter's working assumption for the
 * inbox webhook shape.
 *
 * Confirmed against docs.zernio.com (checked 2026-07-20): every inbox
 * webhook call delivers a JSON object with top-level fields `id` (stable
 * webhook event id), `event` (event name, e.g. "message.received"),
 * `account` (typed `accountInboxWebhookAccount` in their schema — the
 * connected social account), `message` (typed
 * `conversationInboxWebhookConversation` — the conversation/message
 * payload), an optional `metadata` (present only for interactive taps —
 * quick reply / postback / inline keyboard callback), and `timestamp`.
 * Zernio also documents dozens of non-DM event types on the same envelope
 * (comment.received, reaction.received, call.*, account.connected, ...) —
 * see docs/epics/epic_02/T-02-zernio-adapter.md "Скоуп — только DM".
 *
 * Zernio's public docs stop short of the full field-by-field schema for the
 * nested `account`/`message` objects (epic E-002 open question #1,
 * docs/epics/epic_02/_index.md) — the nested shapes below
 * (`ZernioRawAccount`, `ZernioRawMessage`, ...) are this adapter's working
 * assumption, chosen to carry exactly what
 * docs/architecture/05-channels.md's normalized event needs. Nothing is
 * lost if these assumed field names turn out wrong once live payloads are
 * available (T-07, step 6): the *entire* raw envelope is also copied
 * verbatim into `NormalizedEvent.rawMetadata`, and this file is the single
 * place the mapping needs correcting.
 *
 * Zernio's docs don't say whether one HTTP call can batch multiple events;
 * `parseZernioWebhook` accepts either a single envelope object or an array
 * of envelopes defensively — real fixtures below use the single-object
 * form.
 */
interface ZernioRawAccount {
  id: string;
  platform: string;
}

interface ZernioRawAttachment {
  type: string;
  url?: string;
  file_name?: string;
  mime_type?: string;
}

interface ZernioRawSender {
  id: string;
  name?: string | null;
}

interface ZernioRawMessage {
  id: string;
  conversation: { id: string };
  text?: string | null;
  attachments?: ZernioRawAttachment[];
  sender: ZernioRawSender;
}

interface ZernioWebhookEnvelope {
  id: string;
  event: string;
  account: ZernioRawAccount;
  message?: ZernioRawMessage;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

/**
 * DM event types this adapter handles, per T-02's scope ("message.received
 * + статусы доставки, если Zernio их шлёт"). Everything else — including
 * real Zernio event types like comment.received (epic E-002 is DM-only;
 * comments are a later epic) or reaction.received — is an "unknown type"
 * for this adapter and gets skipped, not mapped.
 */
const DM_EVENT_TYPES: Readonly<Record<string, NormalizedEventType>> = {
  "message.received": "message.received",
  "message.delivered": "message.delivered",
  "message.read": "message.read",
  "message.failed": "message.failed",
};

/** Platforms this product supports — epic E-002 scope ("Zernio покрывает платформы: Telegram, WhatsApp, Facebook, Instagram (DM)"). */
const KNOWN_PLATFORMS: ReadonlySet<ChannelPlatform> = new Set([
  "telegram",
  "whatsapp",
  "instagram",
  "facebook",
]);

function isKnownPlatform(platform: string): platform is ChannelPlatform {
  return KNOWN_PLATFORMS.has(platform as ChannelPlatform);
}

function isZernioEnvelope(value: unknown): value is ZernioWebhookEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const account = candidate.account as Record<string, unknown> | undefined;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.event === "string" &&
    typeof account === "object" &&
    account !== null &&
    typeof account.id === "string" &&
    typeof account.platform === "string"
  );
}

function isZernioMessage(value: unknown): value is ZernioRawMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const conversation = candidate.conversation as
    | Record<string, unknown>
    | undefined;
  const sender = candidate.sender as Record<string, unknown> | undefined;

  return (
    typeof candidate.id === "string" &&
    typeof conversation === "object" &&
    conversation !== null &&
    typeof conversation.id === "string" &&
    typeof sender === "object" &&
    sender !== null &&
    typeof sender.id === "string"
  );
}

function mapAttachment(raw: ZernioRawAttachment): NormalizedAttachment {
  return {
    type: raw.type ?? "unknown",
    url: raw.url,
    fileName: raw.file_name,
    mimeType: raw.mime_type,
  };
}

function parseSingleEnvelope(raw: unknown): NormalizedEvent | null {
  if (!isZernioEnvelope(raw)) {
    console.warn(
      "[zernio] skipping malformed webhook envelope (missing id/event/account)",
    );
    return null;
  }

  const normalizedType = DM_EVENT_TYPES[raw.event];
  if (!normalizedType) {
    // Comment webhooks, reactions, account lifecycle, calls, etc. — real
    // Zernio event types, just out of this ticket's DM-only scope. Not an
    // error: skip and keep processing the rest of the batch.
    console.warn(
      `[zernio] skipping unsupported event type "${raw.event}" (event id: ${raw.id})`,
    );
    return null;
  }

  if (!isZernioMessage(raw.message)) {
    console.warn(
      `[zernio] skipping "${raw.event}" event with no usable message payload (event id: ${raw.id})`,
    );
    return null;
  }

  if (!isKnownPlatform(raw.account.platform)) {
    console.warn(
      `[zernio] skipping event for unsupported platform "${raw.account.platform}" (event id: ${raw.id})`,
    );
    return null;
  }

  return {
    type: normalizedType,
    providerEventId: raw.id,
    provider: "zernio",
    platform: raw.account.platform,
    externalAccountId: raw.account.id,
    interactionKind: "dm",
    conversation: { externalId: raw.message.conversation.id },
    message: {
      externalId: raw.message.id,
      text: raw.message.text ?? "",
      attachments: (raw.message.attachments ?? []).map(mapAttachment),
      sender: {
        externalId: raw.message.sender.id,
        displayName: raw.message.sender.name ?? undefined,
      },
    },
    // Kept in full per docs/architecture/05-channels.md#нормализованное-событие
    // — nothing is lost even where the assumed shape above is wrong.
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Parses an already-verified raw Zernio webhook payload into normalized DM
 * events. Unknown event types and malformed entries are skipped (with a
 * console warning) rather than throwing, so one bad/irrelevant event in a
 * batch never drops the rest — see T-02 acceptance criteria.
 *
 * A body that isn't valid JSON is a different, more severe failure than an
 * "unknown event type" and is deliberately not swallowed here: `JSON.parse`
 * throws, and the caller (the webhook route, T-03) is expected to handle
 * that the same way it handles any other unexpected adapter failure.
 */
export function parseZernioWebhook(input: ParseWebhookInput): NormalizedEvent[] {
  const body = JSON.parse(input.rawBody) as unknown;
  const envelopes = Array.isArray(body) ? body : [body];

  const events: NormalizedEvent[] = [];

  for (const envelope of envelopes) {
    const event = parseSingleEnvelope(envelope);
    if (event) {
      events.push(event);
    }
  }

  return events;
}
