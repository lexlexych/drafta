import type {
  ChannelPlatform,
  NormalizedAttachment,
  NormalizedDirectMessageEvent,
  NormalizedEvent,
  NormalizedPostRef,
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
 * `comment.received` is a *different* envelope shape (`WebhookPayloadComment`):
 * a top-level `comment` (with its own `author`, not a DM `sender`) and `post`,
 * and no `message`/`conversation`. Comments of one post share the post's
 * `platformPostId`, so they group into a single `posts` row; a reply-to-a-reply
 * carries `comment.parentCommentId`. The comment webhook does not include the
 * post caption/permalink — only ids. See `buildCommentEvent`.
 *
 * `post.published` is a third shape: a top-level `post` and nothing else. It is
 * what puts a freshly published post into «Комментарии» before it has any
 * comments, and it is where the caption/permalink actually arrive. See
 * `buildPostPublishedEvent`.
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
 * The post a `comment.received` event belongs to, and the subject of a
 * `post.published` event — Zernio's `WebhookPayloadComment.post` /
 * `WebhookPayloadPost.post` (confirmed against docs.zernio.com/api/openapi).
 * Only `platformPostId` is guaranteed: the internal `id` is null for posts not
 * published through Zernio (the common case for organic posts users comment
 * on). A `comment.received` envelope carries ids only — `caption`/`permalink`
 * appear on the publish event, where Zernio does report them.
 */
interface ZernioRawPost {
  id?: string | null;
  platformPostId: string;
  caption?: string | null;
  permalink?: string | null;
  publishedAt?: string | null;
}

interface ZernioRawCommentAuthor {
  id: string;
  username?: string;
  name?: string | null;
  picture?: string | null;
}

/**
 * A comment from a `comment.received` webhook — Zernio's `WebhookPayloadComment.comment`
 * (docs.zernio.com/api/openapi). Note this is a *sibling* of `post`/`account`
 * on the envelope, NOT the DM `message` shape: the author is `author` (not
 * `sender`), the post is keyed by `platformPostId` (internal `postId` may be
 * null), and a reply carries `parentCommentId`.
 */
interface ZernioRawComment {
  id: string;
  postId?: string | null;
  platformPostId: string;
  platform: string;
  text?: string | null;
  author: ZernioRawCommentAuthor;
  createdAt?: string;
  isReply?: boolean;
  parentCommentId?: string | null;
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
}

interface ZernioWebhookEnvelope {
  id: string;
  event: string;
  account: ZernioRawAccount;
  /** Present on DM events (`message.*`). */
  message?: ZernioRawMessage;
  /** Present on DM events — the thread the message belongs to. */
  conversation?: ZernioRawConversation;
  /** Present on `comment.received` — the comment itself. */
  comment?: ZernioRawComment;
  /** Present on `comment.received` — the post the comment is under. */
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
const DM_EVENT_TYPES: Readonly<
  Record<string, NormalizedDirectMessageEvent["type"]>
> = {
  "message.received": "message.received",
  "message.delivered": "message.delivered",
  "message.read": "message.read",
  "message.failed": "message.failed",
};

/**
 * Comment event Zernio delivers (stage 5 —
 * docs/architecture/16-rollout-plan.md#этап-5--комментарии). Unlike a DM, its
 * envelope carries `comment` + `post` (and no `message`/`conversation`): the
 * comment thread is keyed by the post's `platformPostId`, and a reply-to-a-reply
 * sets `comment.parentCommentId`.
 */
const COMMENT_EVENT = "comment.received" as const;

/**
 * Publication of a post on the connected account. Its envelope carries only
 * `post` — no comment yet, by definition. drafta creates the `posts` row on it
 * so the post is listed under «Комментарии» from the moment it goes live.
 */
const POST_PUBLISHED_EVENT = "post.published" as const;

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

function isZernioComment(value: unknown): value is ZernioRawComment {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const author = candidate.author as Record<string, unknown> | undefined;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.platformPostId === "string" &&
    typeof candidate.platform === "string" &&
    typeof author === "object" &&
    author !== null &&
    typeof author.id === "string"
  );
}

function isZernioPost(value: unknown): value is ZernioRawPost {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>).platformPostId === "string";
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

  if (!isKnownPlatform(raw.account.platform)) {
    console.warn(
      `[zernio] skipping event for unsupported platform "${raw.account.platform}" (event id: ${raw.id})`,
    );
    return null;
  }

  if (raw.event === COMMENT_EVENT) {
    return buildCommentEvent(raw, raw.account.platform);
  }

  if (raw.event === POST_PUBLISHED_EVENT) {
    return buildPostPublishedEvent(raw, raw.account.platform);
  }

  const dmType = DM_EVENT_TYPES[raw.event];
  if (dmType) {
    return buildDmEvent(raw, dmType, raw.account.platform);
  }

  // Reactions, account lifecycle, calls, etc. — real Zernio event types this
  // adapter does not map. Not an error: skip and keep processing the batch.
  console.warn(
    `[zernio] skipping unsupported event type "${raw.event}" (event id: ${raw.id})`,
  );
  return null;
}

function buildDmEvent(
  raw: ZernioWebhookEnvelope,
  type: NormalizedDirectMessageEvent["type"],
  platform: ChannelPlatform,
): NormalizedEvent | null {
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

  return {
    type,
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: raw.account.id,
    // `conversation.id` (Zernio's internal conversation ID) rather than
    // `conversation.platformConversationId`: this adapter consistently keys on
    // Zernio's own IDs, which is what `webhook_events`/`messages` idempotency
    // needs (the provider in §5's terms is Zernio, not the underlying platform).
    conversation: { externalId: raw.conversation.id },
    message: {
      externalId: raw.message.id,
      text: raw.message.text ?? "",
      attachments: (raw.message.attachments ?? []).map(mapAttachment),
      sender: {
        externalId: raw.message.sender.id,
        displayName: raw.message.sender.name ?? undefined,
      },
    },
    // Kept in full per docs/architecture/05-channels.md#нормализованное-событие.
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Normalizes Zernio's post shape. `platformPostId` is always the identity:
 * the internal `postId` is null for posts not published through Zernio, so it
 * can't be the key. It is also the value Zernio's reply endpoint
 * (POST /v1/inbox/comments/{postId}) accepts.
 */
function postRef(
  post: ZernioRawPost,
  platform: ChannelPlatform,
  internalPostId: string | null,
): NormalizedPostRef {
  const permalink = post.permalink?.trim();
  const publishedAt = post.publishedAt?.trim();

  return {
    externalId: post.platformPostId,
    text: post.caption ?? "",
    ...(permalink ? { permalink } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    metadata: {
      platformPostId: post.platformPostId,
      postId: internalPostId,
      platform,
    },
  };
}

function buildCommentEvent(
  raw: ZernioWebhookEnvelope,
  platform: ChannelPlatform,
): NormalizedEvent | null {
  if (!isZernioComment(raw.comment)) {
    console.warn(
      `[zernio] skipping "comment.received" event with no usable comment payload (event id: ${raw.id})`,
    );
    return null;
  }

  const comment = raw.comment;
  // A comment envelope carries the post's ids only — no caption, no permalink.
  // The post row keeps whatever a `post.published` event already filled in;
  // this event only has to make sure the row exists.
  const post: ZernioRawPost = raw.post ?? {
    platformPostId: comment.platformPostId,
    id: comment.postId ?? null,
  };

  return {
    type: "comment.received",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: raw.account.id,
    post: postRef(post, platform, comment.postId ?? raw.post?.id ?? null),
    comment: {
      externalId: comment.id,
      text: comment.text ?? "",
      attachments: [],
      author: {
        externalId: comment.author.id,
        displayName:
          comment.author.name ?? comment.author.username ?? undefined,
      },
      ...(comment.parentCommentId
        ? { parentExternalId: comment.parentCommentId }
        : {}),
    },
    // Kept in full per docs/architecture/05-channels.md#нормализованное-событие.
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

function buildPostPublishedEvent(
  raw: ZernioWebhookEnvelope,
  platform: ChannelPlatform,
): NormalizedEvent | null {
  if (!isZernioPost(raw.post)) {
    console.warn(
      `[zernio] skipping "post.published" event with no usable post payload (event id: ${raw.id})`,
    );
    return null;
  }

  return {
    type: "post.published",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: raw.account.id,
    post: postRef(raw.post, platform, raw.post.id ?? null),
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
