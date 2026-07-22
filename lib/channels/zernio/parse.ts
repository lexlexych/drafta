import type {
  ChannelPlatform,
  NormalizedAttachment,
  NormalizedEvent,
  NormalizedEventType,
  ParseWebhookInput,
} from "../types";

/**
 * Raw Zernio webhook envelope — this adapter's model of the inbox webhook
 * shape.
 *
 * Confirmed against Zernio's public OpenAPI spec
 * (https://docs.zernio.com/api/openapi, re-checked 2026-07-20 against the
 * `WebhookPayloadMessage` / `WebhookPayloadMessageDeliveryStatus` schemas
 * after epic E-002's review caught the first pass mis-reading it — see
 * "Доработка 1" in this ticket's dev report): every inbox webhook call
 * delivers a JSON object with **top-level, sibling** fields `id` (stable
 * webhook event id), `event` (event name, e.g. "message.received"),
 * `account` (schema `InboxWebhookAccount` — the connected social account),
 * `message` (schema `InboxWebhookMessage`), `conversation` (schema
 * `InboxWebhookConversation` — a *sibling* of `message`, not nested inside
 * it), an optional `metadata` (present only for interactive taps — quick
 * reply / postback / inline keyboard callback), and `timestamp`. Zernio also
 * documents dozens of non-DM event types on the same shape of envelope
 * (comment.received, reaction.received, call.*, account.connected, ...) —
 * see docs/epics/epic_02/T-02-zernio-adapter.md "Скоуп — только DM".
 *
 * `InboxWebhookMessage` itself only exposes a flat `conversationId` string —
 * there is no nested `message.conversation` object in the real schema; the
 * conversation's identity for a DM thread comes from the envelope's
 * top-level `conversation.id` (Zernio's own internal conversation ID; the
 * schema also exposes `platformConversationId`, the platform-native ID —
 * see the `conversation` field mapping in `parseSingleEnvelope` below for
 * why this adapter picks the internal one).
 *
 * Stage 5 (docs/architecture/16-rollout-plan.md#этап-5--комментарии) adds
 * `comment.received`: the same envelope shape plus a top-level `post`
 * (`InboxWebhookPost` — the post the comment belongs to) and an optional
 * `message.parentId` (the parent comment for a reply-to-a-reply). Comments of
 * one post share the envelope's `conversation.id`, so they group into a single
 * `kind = comments` conversation; the post's identity/preview is normalized
 * into `conversation.postMetadata`.
 *
 * `InboxWebhookMessage.attachments[]` only carries `type`, `url`, and an
 * opaque `payload` object ("additional attachment metadata", undocumented
 * sub-shape) — there is no `file_name`/`mime_type` field. See
 * `mapAttachment` below.
 *
 * The nested shapes below (`ZernioRawAccount`, `ZernioRawMessage`,
 * `ZernioRawConversation`, `ZernioRawAttachment`) only declare the subset of
 * each real schema's fields this adapter actually maps — not the full
 * schema (e.g. WhatsApp BSUID fields, Instagram profile flags, Meta ad
 * referral data are real fields but out of this ticket's DM-mapping scope).
 * Nothing is lost even so: the *entire* raw envelope is also copied verbatim
 * into `NormalizedEvent.rawMetadata`.
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

interface ZernioRawConversation {
  /** Zernio's internal conversation ID — see `parseSingleEnvelope` for why this, not `platformConversationId`, is used as the normalized conversation's `externalId`. */
  id: string;
  platformConversationId?: string;
}

/**
 * The post a `comment.received` event belongs to — Zernio's `InboxWebhookPost`
 * schema (id + a preview of the caption and a permalink). For comments the
 * "conversation" is the post; this maps to `conversations.post_metadata`
 * (docs/architecture/06-data-model.md#conversations). Only present on comment
 * envelopes.
 */
interface ZernioRawPost {
  id: string;
  text?: string | null;
  permalink?: string | null;
}

interface ZernioRawAttachment {
  type: string;
  url?: string;
  /** Opaque, undocumented sub-shape ("additional attachment metadata") — kept only via `rawMetadata`, not mapped field by field. */
  payload?: Record<string, unknown>;
}

interface ZernioRawSender {
  id: string;
  name?: string | null;
}

interface ZernioRawMessage {
  id: string;
  text?: string | null;
  attachments?: ZernioRawAttachment[];
  sender: ZernioRawSender;
  /** For a `comment.received` reply-to-a-reply: the parent comment's ID. Absent on DM and top-level comments. */
  parentId?: string | null;
}

interface ZernioWebhookEnvelope {
  id: string;
  event: string;
  account: ZernioRawAccount;
  message?: ZernioRawMessage;
  conversation?: ZernioRawConversation;
  /** Present only on `comment.received` envelopes — the post the comment is under. */
  post?: ZernioRawPost;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

/**
 * DM event types this adapter handles, per T-02's scope ("message.received
 * + статусы доставки, если Zernio их шлёт"). Comment events are handled
 * separately (`COMMENT_EVENT` below, stage 5). Everything else — reactions,
 * account lifecycle, calls — is an "unknown type" for this adapter and gets
 * skipped, not mapped.
 */
const DM_EVENT_TYPES: Readonly<Record<string, NormalizedEventType>> = {
  "message.received": "message.received",
  "message.delivered": "message.delivered",
  "message.read": "message.read",
  "message.failed": "message.failed",
};

/**
 * Comment event Zernio delivers on the same envelope shape (stage 5 —
 * docs/architecture/16-rollout-plan.md#этап-5--комментарии). Its envelope
 * additionally carries a top-level `post` (the post the comment is under);
 * `message.parentId` is set when the comment replies to another comment.
 */
const COMMENT_EVENT = "comment.received" as const;

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
  const sender = candidate.sender as Record<string, unknown> | undefined;

  return (
    typeof candidate.id === "string" &&
    typeof sender === "object" &&
    sender !== null &&
    typeof sender.id === "string"
  );
}

function isZernioConversation(value: unknown): value is ZernioRawConversation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.id === "string";
}

function isZernioPost(value: unknown): value is ZernioRawPost {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>).id === "string";
}

/**
 * Zernio's real attachment schema (`InboxWebhookMessage.attachments`,
 * confirmed via docs.zernio.com/api/openapi) only exposes `type`, `url`,
 * and an opaque `payload` object — there's no documented `file_name` or
 * `mime_type` field. `fileName`/`mimeType` are deliberately left `undefined`
 * here rather than guessed out of `payload`'s undocumented sub-shape;
 * nothing is lost regardless, since `payload` — like the rest of the
 * envelope — also survives verbatim in `NormalizedEvent.rawMetadata`.
 */
function mapAttachment(raw: ZernioRawAttachment): NormalizedAttachment {
  return {
    type: raw.type ?? "unknown",
    url: raw.url,
  };
}

function parseSingleEnvelope(raw: unknown): NormalizedEvent | null {
  if (!isZernioEnvelope(raw)) {
    console.warn(
      "[zernio] skipping malformed webhook envelope (missing id/event/account)",
    );
    return null;
  }

  const isComment = raw.event === COMMENT_EVENT;
  const normalizedType: NormalizedEventType | undefined = isComment
    ? "comment.received"
    : DM_EVENT_TYPES[raw.event];

  if (!normalizedType) {
    // Reactions, account lifecycle, calls, etc. — real Zernio event types
    // this adapter does not map. Not an error: skip and keep processing the
    // rest of the batch.
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

  if (!isZernioConversation(raw.conversation)) {
    console.warn(
      `[zernio] skipping "${raw.event}" event with no usable conversation payload (event id: ${raw.id})`,
    );
    return null;
  }

  if (isComment && !isZernioPost(raw.post)) {
    // A comment without its post can't be grouped under a post thread
    // (docs/architecture/06-data-model.md#conversations) — skip, don't guess.
    console.warn(
      `[zernio] skipping "comment.received" event with no usable post payload (event id: ${raw.id})`,
    );
    return null;
  }

  if (!isKnownPlatform(raw.account.platform)) {
    console.warn(
      `[zernio] skipping event for unsupported platform "${raw.account.platform}" (event id: ${raw.id})`,
    );
    return null;
  }

  const platform = raw.account.platform;

  return {
    type: normalizedType,
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: raw.account.id,
    interactionKind: isComment ? "comment" : "dm",
    // `conversation.id` (Zernio's internal conversation ID) rather than
    // `conversation.platformConversationId`: same choice as `message.id`
    // below (Zernio's internal message ID, not `platformMessageId`) — this
    // adapter consistently keys on Zernio's own IDs, which is what
    // `webhook_events`/`messages` idempotency needs (the provider in
    // §5's terms is Zernio, not the underlying platform). For comments this
    // id groups every comment of one post into a single conversation (post
    // thread); the post's own identity/preview travels in `postMetadata`.
    conversation: {
      externalId: raw.conversation.id,
      ...(isComment && raw.post
        ? {
            postMetadata: {
              externalId: raw.post.id,
              text: raw.post.text ?? "",
              permalink: raw.post.permalink ?? null,
              platform,
            },
          }
        : {}),
    },
    message: {
      externalId: raw.message.id,
      text: raw.message.text ?? "",
      attachments: (raw.message.attachments ?? []).map(mapAttachment),
      sender: {
        externalId: raw.message.sender.id,
        displayName: raw.message.sender.name ?? undefined,
      },
      ...(isComment && raw.message.parentId
        ? { parentExternalId: raw.message.parentId }
        : {}),
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
