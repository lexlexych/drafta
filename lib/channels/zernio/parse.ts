import type {
  ChannelPlatform,
  NormalizedAttachment,
  NormalizedDirectMessageEvent,
  NormalizedEvent,
  NormalizedPostRef,
  NormalizedSender,
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
 * carries `comment.parentCommentId`. Its `post` block carries the post's own
 * `content` (the caption), `imageUrl` and `permalink` — from Zernio's synced
 * copy, no platform call on the comment path. See `buildCommentEvent`.
 *
 * `conversation.started` (`WebhookPayloadConversationStarted`) and
 * `message.sent` (`WebhookPayloadMessageSent`) are the outbound half of the DM
 * lifecycle. Both carry the envelope's `conversation` block — including
 * `participantId`, the only place the contact is named on an event whose sender
 * is the business itself. drafta needs them because a thread can begin without
 * any inbound message: a private reply to a comment opens one.
 *
 * `post.external.created` / `post.external.updated` (`WebhookPayloadExternalPost`)
 * are what put a post published *natively* — from the Instagram app, not through
 * Zernio — into «Публикации» before anyone comments. Zernio detects those by
 * background sync, so they are poll-driven (~hourly), not real-time. The post
 * block is `ExternalPostWebhookPost`: `id` is the platform-native post id,
 * `url`/`content`/`thumbnailUrl`/`publishedAt` the rest. See
 * `buildExternalPostEvent`.
 *
 * `post.platform.published` (`WebhookPayloadPostPlatform`) is the same thing for
 * a post published *through* Zernio: one event per platform target, carrying the
 * `account` it published through and a `platform` block with `platformPostId` and
 * `publishedUrl`. The post-level rollup `post.published` is deliberately NOT
 * handled — its payload carries no `account` at all (the accounts sit inside
 * `post.platforms[]`), and every target it covers already arrives as its own
 * `post.platform.published`. See `buildPostPlatformEvent`.
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
  /**
   * Social account id. Present as `id` on the inbox envelopes and as
   * `accountId` on the publishing ones (`WebhookPayloadPostPlatform`); Zernio
   * documents `accountId` as the canonical field and sets both where it can, so
   * this adapter reads `id` first and falls back — see `envelopeAccountId`.
   */
  id?: string;
  accountId?: string;
  platform: string;
}

interface ZernioRawConversation {
  /** Zernio's internal conversation ID — see `parseSingleEnvelope` for why this, not `platformConversationId`, is used as the normalized conversation's `externalId`. */
  id: string;
  platformConversationId?: string;
  /**
   * The contact on the other side. Present on every inbox envelope, and the
   * only way to name them on events whose sender is the business itself
   * (`message.sent`) or which carry no message at all
   * (`conversation.started`).
   */
  participantId?: string;
  participantName?: string | null;
  participantUsername?: string | null;
  participantPicture?: string | null;
}

/**
 * The post a `comment.received` event belongs to — Zernio's
 * `WebhookPayloadComment.post` (confirmed against docs.zernio.com/api/openapi).
 * Only `platformPostId` is guaranteed: the internal `id` is null for posts not
 * published through Zernio (the common case for organic posts users comment
 * on), and `content`/`imageUrl`/`permalink` come from Zernio's synced copy, so
 * they are null for a post their sync has not seen yet.
 */
interface ZernioRawCommentPost {
  id?: string | null;
  platformPostId: string;
  /** Post text — the caption shown as the post's title in «Публикации». */
  content?: string | null;
  /** Post thumbnail or first media item; platform CDN URLs expire. */
  imageUrl?: string | null;
  permalink?: string | null;
}

/**
 * A natively-authored post detected by Zernio's background sync — the `post`
 * block of `post.external.*` (`ExternalPostWebhookPost`). Unlike the comment
 * envelope, `id` here is the *platform-native* post id, which is what
 * `posts.external_id` stores, so both paths key on the same value.
 */
interface ZernioRawExternalPost {
  id: string;
  platform?: string;
  accountId?: string;
  url?: string | null;
  content?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  source?: string;
}

/**
 * The platform target that just went live on a `post.platform.published` event
 * (`WebhookPayloadPostPlatform.platform`). `platformPostId` and `publishedUrl`
 * are documented as present on `published`, absent on `failed`.
 */
interface ZernioRawPostPlatformTarget {
  name?: string;
  status?: string;
  platformPostId?: string;
  publishedUrl?: string;
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
  picture?: string | null;
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
  /**
   * The post the comment is under (`comment.received`), or the post itself
   * (`post.external.*`, `post.platform.published`) — the two shapes are told
   * apart by `isZernioCommentPost` / `isZernioExternalPost`.
   */
  post?: ZernioRawCommentPost | ZernioRawExternalPost;
  /** Present on `post.platform.published` — the platform target that went live. */
  platform?: ZernioRawPostPlatformTarget;
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
 * A DM thread appearing for the first time, in either direction. drafta creates
 * `conversations` rows from inbound messages, which leaves out exactly the
 * thread a private reply to a comment opens — this event covers it.
 */
const CONVERSATION_STARTED_EVENT = "conversation.started" as const;

/**
 * A message the connected account sent — from drafta, from Zernio's own
 * dashboard, or as a private reply. Ours are already in `messages` and get
 * deduplicated downstream; the rest are how the operator sees what was sent
 * outside drafta.
 */
const OUTGOING_MESSAGE_EVENT = "message.sent" as const;

/**
 * Publication of a post on the connected account — no comment yet, by
 * definition. drafta creates the `posts` row on these so a post is listed under
 * «Публикации» from the moment it goes live:
 *
 *   * `post.external.created` / `post.external.updated` — published natively
 *     (from the Instagram app). This is the normal case for drafta's users, and
 *     it is poll-driven on Zernio's side (~hourly), not real-time;
 *   * `post.platform.published` — published through Zernio, one event per
 *     platform target.
 */
const EXTERNAL_POST_EVENTS: ReadonlySet<string> = new Set([
  "post.external.created",
  "post.external.updated",
]);

const POST_PLATFORM_PUBLISHED_EVENT = "post.platform.published" as const;

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
    (typeof account.id === "string" || typeof account.accountId === "string") &&
    typeof account.platform === "string"
  );
}

/**
 * The connected account this envelope is about. Publishing events name it
 * `accountId` while inbox events name it `id`; `isZernioEnvelope` has already
 * established that at least one of them is a string.
 */
function envelopeAccountId(raw: ZernioWebhookEnvelope): string {
  return (raw.account.id ?? raw.account.accountId) as string;
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

function isZernioCommentPost(value: unknown): value is ZernioRawCommentPost {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>).platformPostId === "string";
}

/** A `post.external.*` post block: keyed by the platform-native `id`. */
function isZernioExternalPost(value: unknown): value is ZernioRawExternalPost {
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

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

  if (raw.event === CONVERSATION_STARTED_EVENT) {
    return buildConversationStartedEvent(raw, raw.account.platform);
  }

  if (raw.event === OUTGOING_MESSAGE_EVENT) {
    return buildOutgoingMessageEvent(raw, raw.account.platform);
  }

  if (EXTERNAL_POST_EVENTS.has(raw.event)) {
    return buildExternalPostEvent(raw, raw.account.platform);
  }

  if (raw.event === POST_PLATFORM_PUBLISHED_EVENT) {
    return buildPostPlatformEvent(raw, raw.account.platform);
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

/**
 * The contact on the other side of a thread, from the envelope's `conversation`
 * block. Undefined when the provider did not name them — the thread is still
 * worth creating, it just has no contact attached yet.
 */
function conversationParticipant(
  conversation: ZernioRawConversation,
): NormalizedSender | undefined {
  const externalId = nonEmptyString(conversation.participantId);
  if (!externalId) {
    return undefined;
  }

  return {
    externalId,
    displayName:
      nonEmptyString(conversation.participantName) ??
      nonEmptyString(conversation.participantUsername) ??
      undefined,
    avatarUrl: nonEmptyString(conversation.participantPicture) ?? undefined,
  };
}

function buildConversationStartedEvent(
  raw: ZernioWebhookEnvelope,
  platform: ChannelPlatform,
): NormalizedEvent | null {
  if (!isZernioConversation(raw.conversation)) {
    console.warn(
      `[zernio] skipping "${raw.event}" event with no usable conversation payload (event id: ${raw.id})`,
    );
    return null;
  }

  const participant = conversationParticipant(raw.conversation);

  return {
    type: "conversation.started",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: envelopeAccountId(raw),
    conversation: { externalId: raw.conversation.id },
    ...(participant ? { participant } : {}),
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

function buildOutgoingMessageEvent(
  raw: ZernioWebhookEnvelope,
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

  const participant = conversationParticipant(raw.conversation);

  return {
    type: "message.sent",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: envelopeAccountId(raw),
    conversation: { externalId: raw.conversation.id },
    // `message.sender` here is the business account, not a contact — the person
    // on the other side comes from the conversation block instead.
    ...(participant ? { participant } : {}),
    message: {
      externalId: raw.message.id,
      text: raw.message.text ?? "",
      attachments: (raw.message.attachments ?? []).map(mapAttachment),
    },
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
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
    externalAccountId: envelopeAccountId(raw),
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
        avatarUrl:
          nonEmptyString(raw.conversation.participantPicture) ??
          nonEmptyString(raw.message.sender.picture) ??
          undefined,
      },
    },
    // Kept in full per docs/architecture/05-channels.md#нормализованное-событие.
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Normalizes the post a comment sits under. The platform's own post id is
 * always the identity: the internal `postId` is null for posts not published
 * through Zernio, so it can't be the key. It is also the value Zernio's reply
 * endpoint (POST /v1/inbox/comments/{postId}) accepts.
 *
 * `content`/`imageUrl`/`permalink` ride along on every comment event, from
 * Zernio's synced copy of the post — which is why a post first seen through a
 * comment still gets its caption and preview without any extra API call.
 */
function commentPostRef(
  post: ZernioRawCommentPost,
  platform: ChannelPlatform,
  internalPostId: string | null,
): NormalizedPostRef {
  return {
    externalId: post.platformPostId,
    text: post.content ?? "",
    ...optionalUrl("permalink", post.permalink),
    ...optionalUrl("thumbnailUrl", post.imageUrl),
    metadata: {
      platformPostId: post.platformPostId,
      postId: internalPostId,
      platform,
    },
  };
}

/** Same normalized shape from a `post.external.*` / `post.platform.*` payload. */
function publishedPostRef(input: {
  platformPostId: string;
  platform: ChannelPlatform;
  text?: string | null;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
}): NormalizedPostRef {
  const publishedAt = input.publishedAt?.trim();

  return {
    externalId: input.platformPostId,
    text: input.text ?? "",
    ...optionalUrl("permalink", input.permalink),
    ...optionalUrl("thumbnailUrl", input.thumbnailUrl),
    ...(publishedAt ? { publishedAt } : {}),
    metadata: {
      platformPostId: input.platformPostId,
      // Published-post envelopes don't report Zernio's own post id in a form
      // this adapter keys on; `platformPostId` above is the identity anyway.
      postId: null,
      platform: input.platform,
    },
  };
}

/** Spreads `{ key: value }` only when the provider actually reported one. */
function optionalUrl(
  key: "permalink" | "thumbnailUrl",
  value: string | null | undefined,
): Record<string, string> {
  const trimmed = nonEmptyString(value);
  return trimmed ? { [key]: trimmed } : {};
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
  // The envelope's `post` block carries the caption, preview and permalink from
  // Zernio's synced copy. It is optional here only defensively: without it the
  // event still has to make sure the `posts` row exists, keyed by the id the
  // comment itself reports.
  const post: ZernioRawCommentPost = isZernioCommentPost(raw.post)
    ? raw.post
    : { platformPostId: comment.platformPostId, id: comment.postId ?? null };

  return {
    type: "comment.received",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: envelopeAccountId(raw),
    post: commentPostRef(post, platform, comment.postId ?? post.id ?? null),
    comment: {
      externalId: comment.id,
      text: comment.text ?? "",
      attachments: [],
      author: {
        externalId: comment.author.id,
        displayName:
          comment.author.name ?? comment.author.username ?? undefined,
        avatarUrl: nonEmptyString(comment.author.picture) ?? undefined,
      },
      ...(comment.parentCommentId
        ? { parentExternalId: comment.parentCommentId }
        : {}),
    },
    // Kept in full per docs/architecture/05-channels.md#нормализованное-событие.
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

/**
 * A post published natively on the platform, which Zernio's background sync
 * discovered (`post.external.created`) or noticed an edit to
 * (`post.external.updated`). `upsertPost` only ever fills empty columns, so the
 * "updated" variant is safe to map identically: it re-asserts the row without
 * overwriting anything already stored.
 */
function buildExternalPostEvent(
  raw: ZernioWebhookEnvelope,
  platform: ChannelPlatform,
): NormalizedEvent | null {
  if (!isZernioExternalPost(raw.post)) {
    console.warn(
      `[zernio] skipping "${raw.event}" event with no usable post payload (event id: ${raw.id})`,
    );
    return null;
  }

  const post = raw.post;

  return {
    type: "post.published",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: envelopeAccountId(raw),
    post: publishedPostRef({
      platformPostId: post.id,
      platform,
      text: post.content,
      permalink: post.url,
      thumbnailUrl: post.thumbnailUrl,
      publishedAt: post.publishedAt,
    }),
    rawMetadata: raw as unknown as Record<string, unknown>,
  };
}

/**
 * One platform target of a post published *through* Zernio reaching its
 * terminal state. Only `status: "published"` produces a row — a failed target
 * has no platform post to list, and the same envelope shape is reused by
 * `post.platform.failed`/`.deleted`, which this adapter does not subscribe to.
 */
function buildPostPlatformEvent(
  raw: ZernioWebhookEnvelope,
  platform: ChannelPlatform,
): NormalizedEvent | null {
  const target = raw.platform;
  const platformPostId = nonEmptyString(target?.platformPostId);

  if (!platformPostId || target?.status !== "published") {
    console.warn(
      `[zernio] skipping "${raw.event}" event with no published platform post id (event id: ${raw.id})`,
    );
    return null;
  }

  const post = isZernioExternalPost(raw.post) ? raw.post : null;

  return {
    type: "post.published",
    providerEventId: raw.id,
    provider: "zernio",
    platform,
    externalAccountId: envelopeAccountId(raw),
    post: publishedPostRef({
      platformPostId,
      platform,
      // The rollup `post` block here is Zernio's own post (its `id` is internal,
      // not the platform's) — only its text and timestamp are of any use.
      text: post?.content,
      permalink: target.publishedUrl,
      publishedAt: post?.publishedAt,
    }),
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
