/**
 * Provider-agnostic core of the channel abstraction layer.
 *
 * See docs/architecture/05-channels.md for the full specification — every
 * type here is a normalized shape shared by all providers (Zernio, Postmark,
 * Meta…).
 *
 * Rule (docs/architecture/05-channels.md#дисциплина, vibecoding rule 4):
 * provider-specific code lives only under `lib/channels/<provider>/`. This
 * file — and the rest of `lib/channels/` outside provider subfolders — must
 * never import a provider SDK or provider-specific type.
 */

/** Providers that implement the channel adapter interface. */
export type ChannelProvider = "zernio" | "postmark" | "meta";

/** Social/messaging platforms normalized events and channel_connections reference. */
export type ChannelPlatform = "telegram" | "whatsapp" | "instagram" | "facebook";

/** Normalized event type — see docs/architecture/05-channels.md#нормализованное-событие. */
export type NormalizedEventType =
  | "message.received"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "conversation.started"
  | "comment.received"
  | "post.published";

/**
 * Whether an outgoing send addresses a DM thread or a comment on a post. Kept
 * for `SendMessageInput`; inbound events no longer carry it — a DM event, a
 * comment event and a post event are three distinct normalized shapes.
 */
export type InteractionKind = "dm" | "comment";

/**
 * Attachment metadata only. MVP does not download or mirror attachment
 * files — see epic E-002 scope ("вне скоупа" §4, вложения).
 */
export interface NormalizedAttachment {
  /** Provider-specific attachment kind, e.g. "image", "video", "audio", "file". */
  type: string;
  /** Provider-hosted URL, when the provider exposes one. */
  url?: string;
  /** Original file name, when known. */
  fileName?: string;
  /** MIME type, when known. */
  mimeType?: string;
}

/** Sender of a message/comment, identified by the provider's own ID. */
export interface NormalizedSender {
  /** External ID of the sender at the provider (user, page, or account ID). */
  externalId: string;
  /** Display name as reported by the provider, when available. */
  displayName?: string;
  /** Provider-hosted profile picture URL, when the provider exposes one. */
  avatarUrl?: string;
}

/** The direct-message body carried by a `message.*` event. */
export interface NormalizedMessage {
  /**
   * External ID of the message at the provider — together with the
   * conversation, this is the `messages` table's idempotency key.
   */
  externalId: string;
  /**
   * External ID of the same message at the *platform* (Instagram mid, WhatsApp
   * wamid), when the provider reports one alongside its own.
   *
   * Two keys exist because a message can be known under two IDs at once, and
   * drafta's own rows are keyed by whichever one the send endpoint returned:
   * Zernio's `sendInboxMessage` answers with the platform ID while its webhooks
   * identify the same message by Zernio's internal ID. Matching a webhook
   * against `messages.external_id` therefore has to try both — see
   * `messageExternalIds` in lib/webhooks/process-event.ts.
   */
  platformExternalId?: string;
  text: string;
  attachments: NormalizedAttachment[];
  sender: NormalizedSender;
}

/** Reference to the DM thread a `message.*` event belongs to. */
export interface NormalizedConversationRef {
  /** External ID of the DM thread. */
  externalId: string;
}

/**
 * A message *we* sent, as the provider reports it back.
 *
 * Deliberately without a `sender`: the sender is the connected account, not a
 * contact, and treating it like one would mint a contact for our own business.
 */
export interface NormalizedOutgoingMessage {
  /** External ID of the message at the provider — the idempotency key. */
  externalId: string;
  /**
   * External ID of the same message at the platform — see
   * `NormalizedMessage.platformExternalId`. This is the key that matches an
   * echo against a message drafta itself sent.
   */
  platformExternalId?: string;
  text: string;
  attachments: NormalizedAttachment[];
}

/**
 * The post a comment belongs to, or a newly published one. `externalId` is the
 * provider-side post ID — the key `posts.external_id` stores, and the value a
 * later comment on the same post reports. Everything else is optional: not every
 * provider reports the caption, the link or a preview on every event.
 */
export interface NormalizedPostRef {
  externalId: string;
  /** Caption/body of the post, when the provider reports it. */
  text?: string;
  /** Public link to the post, when the provider reports one. */
  permalink?: string;
  /** Preview image of the post, when the provider reports one. */
  thumbnailUrl?: string;
  /** Publication timestamp (ISO-8601), when the provider reports one. */
  publishedAt?: string;
  /** Anything else worth keeping about the post — stored as `posts.metadata`. */
  metadata?: Record<string, unknown>;
}

/** The comment body carried by a `comment.received` event. */
export interface NormalizedComment {
  /**
   * External ID of the comment at the provider — together with the post, this
   * is the `comments` table's idempotency key.
   */
  externalId: string;
  text: string;
  attachments: NormalizedAttachment[];
  author: NormalizedSender;
  /**
   * External ID of the parent comment this one replies to (a reply-to-a-reply),
   * when the provider reports one. Absent for top-level comments. Stored as
   * `comments.parent_external_id`.
   */
  parentExternalId?: string;
}

/** Fields every normalized event carries, whatever its shape. */
interface NormalizedEventBase {
  /** Event ID at the provider — the `webhook_events` idempotency key together with provider. */
  providerEventId: string;
  provider: ChannelProvider;
  platform: ChannelPlatform;
  /**
   * External ID of the connected social account. Resolves to a
   * `channel_connections` row via (provider, externalAccountId) — the row's
   * own UUID isn't known yet while parsing a raw webhook.
   */
  externalAccountId: string;
  /**
   * Raw provider metadata for this event, kept in full — nothing gets lost
   * even where the normalized fields above are incomplete (email headers,
   * parent post/comment IDs, etc).
   */
  rawMetadata: Record<string, unknown>;
}

/** A direct message, or a delivery-status update for one we sent. */
export interface NormalizedDirectMessageEvent extends NormalizedEventBase {
  type: "message.received" | "message.delivered" | "message.read" | "message.failed";
  conversation: NormalizedConversationRef;
  message: NormalizedMessage;
}

/**
 * A comment under a post. Deliberately *not* shaped like a DM: comments live in
 * their own tables and their own pipeline, so nothing downstream has to branch
 * on a `kind` discriminator inside a shared shape.
 */
export interface NormalizedCommentEvent extends NormalizedEventBase {
  type: "comment.received";
  post: NormalizedPostRef;
  comment: NormalizedComment;
}

/**
 * A DM thread appearing for the first time, in either direction.
 *
 * drafta needs it because a thread can start without an inbound message: a
 * private reply to a comment opens one, and until this event arrives that
 * conversation exists at the provider but nowhere in «Сообщения».
 */
export interface NormalizedConversationStartedEvent extends NormalizedEventBase {
  type: "conversation.started";
  conversation: NormalizedConversationRef;
  /** The contact on the other side, when the provider names them. */
  participant?: NormalizedSender;
}

/**
 * A message the connected account sent — through drafta, through the provider's
 * own dashboard, or as a private reply to a comment. Ours already sit in
 * `messages`, so the handler's job is mostly to notice the ones that are not.
 */
export interface NormalizedOutgoingMessageEvent extends NormalizedEventBase {
  type: "message.sent";
  conversation: NormalizedConversationRef;
  message: NormalizedOutgoingMessage;
  /** The contact on the other side, when the provider names them. */
  participant?: NormalizedSender;
}

/**
 * A post published on the connected account. It creates the `posts` row right
 * away, so the post shows up under «Комментарии» before anyone has commented.
 */
export interface NormalizedPostPublishedEvent extends NormalizedEventBase {
  type: "post.published";
  post: NormalizedPostRef;
}

/**
 * A single provider webhook payload normalizes to zero or more of these.
 * This is the contract every adapter's `parseWebhook` must produce, and the
 * one every consumer downstream of `lib/channels` (webhook route, inbox)
 * relies on — see docs/architecture/05-channels.md#нормализованное-событие.
 */
export type NormalizedEvent =
  | NormalizedDirectMessageEvent
  | NormalizedConversationStartedEvent
  | NormalizedOutgoingMessageEvent
  | NormalizedCommentEvent
  | NormalizedPostPublishedEvent;

/** Input to `verifyWebhook` — the exact bytes/headers the provider sent, needed for signature checks. */
export interface VerifyWebhookInput {
  /** Raw request body, unparsed (signatures are computed over exact bytes). */
  rawBody: string;
  /** Request headers with lower-cased keys. */
  headers: Record<string, string>;
}

/** Input to `parseWebhook` — the same raw payload, once the signature is already verified. */
export interface ParseWebhookInput {
  rawBody: string;
  headers: Record<string, string>;
}

/**
 * One envelope the adapter received but could not turn into a normalized
 * event: an event type it does not map, an unknown platform, or a payload
 * missing the fields the provider's own schema promises.
 *
 * These used to leave nothing behind but a console line, which is the worst
 * possible trade for diagnosis: the route answers 200, the provider considers
 * the delivery done, and no row anywhere records that the message ever
 * existed. Exactly that combination hid a whole class of missing Instagram
 * messages until a provider-side log turned it up. They are journaled into
 * `webhook_events` instead — see `lib/webhooks/journal-unparsed.ts`.
 *
 * Both ids are nullable on purpose: an envelope malformed enough to be
 * refused may also be missing them.
 */
export interface UnparsedEnvelope {
  /** The provider's own event id, when the envelope carried a usable one. */
  providerEventId: string | null;
  /** The connected account the envelope named, when it named one. */
  externalAccountId: string | null;
  /** Why the adapter refused it — journaled verbatim as `processing_error`. */
  reason: string;
  /** The envelope exactly as received, for the journal's `payload`. */
  rawEnvelope: Record<string, unknown>;
}

/**
 * What one raw webhook payload normalizes to: the events to process, plus
 * everything in the same delivery the adapter had to refuse. A batch can
 * produce both — one bad envelope never costs the rest their processing.
 */
export interface ParseWebhookResult {
  events: NormalizedEvent[];
  unparsed: UnparsedEnvelope[];
}

/** Input to `sendMessage` — see docs/architecture/05-channels.md (stage 3 of the rollout plan). */
export interface SendMessageInput {
  channelConnectionId: string;
  /**
   * External ID of the connected social account at the provider — the same
   * value as `NormalizedEvent.externalAccountId` / the `channel_connections`
   * row's `external_id`. Passed in by the caller because adapters never read
   * the database (vibecoding rule 4).
   */
  externalAccountId: string;
  /** `conversations.external_id` for a DM; `posts.external_id` for a comment reply. */
  conversationExternalId: string;
  text: string;
  attachments?: NormalizedAttachment[];
  /**
   * DM vs comment reply. Defaults to `"dm"` when omitted so existing callers
   * keep the same behavior. For `"comment"` the adapter posts a reply to a
   * specific comment rather than into a DM thread.
   */
  interactionKind?: InteractionKind;
  /**
   * External ID of the comment being replied to — required when
   * `interactionKind === "comment"`. Comes from
   * `comments.parent_external_id` of the outgoing reply
   * (docs/architecture/07-data-flows.md#63-отправка-ответа: «для комментария —
   * как ответ на конкретный комментарий»).
   */
  parentExternalId?: string | null;
}

export interface SendMessageResult {
  /** External ID the provider assigned to the sent message. */
  providerMessageId: string;
}

/** Input to the optional `getConnectUrl` — starts the provider's account-connect flow. */
export interface GetConnectUrlInput {
  /** Platform the user is connecting — the provider's connect flow needs it up front. */
  platform: ChannelPlatform;
  /**
   * Absolute URL the provider must redirect the browser back to once the
   * account is authorized. The caller carries its own anti-CSRF nonce inside
   * this URL (the provider only appends its own params to it).
   */
  redirectUrl: string;
  /**
   * Opaque provider-side account-grouping id (Zernio "profile", etc.) to
   * connect the account under. Zernio requires the profile created during
   * workspace bootstrap; another provider may define a different lifecycle.
   */
  providerProfileId?: string | null;
}

/** Result of the optional `getConnectUrl`. */
export interface GetConnectUrlResult {
  /** The provider's authorization URL to redirect the browser to. */
  url: string;
  /**
   * The provider-side account-grouping id actually used.
   */
  providerProfileId: string;
}

/** Input to the optional `disconnectAccount` — which connected account to drop at the provider. */
export interface DisconnectAccountInput {
  /**
   * External ID of the connected social account — `channel_connections.external_id`,
   * the same value `parseConnectCallback` returned when it was connected.
   */
  externalAccountId: string;
}

/** Input to the optional participant-avatar lookup. */
export interface FetchParticipantAvatarInput {
  externalAccountId: string;
  participantExternalId: string;
  /** Provider conversation id, when a direct lookup is available. */
  conversationExternalId?: string;
}

export interface FetchParticipantAvatarResult {
  avatarUrl: string | null;
  /** The participant was found even when their account has no profile picture. */
  found: boolean;
}

/**
 * Input to the optional private reply — a DM to the author of a comment.
 *
 * Meta's «private reply» is not an ordinary DM: it is addressed to a comment,
 * not to a thread, which is exactly why it can open a conversation that does
 * not exist yet. The platform allows one per comment, within 7 days of it.
 */
export interface SendCommentPrivateReplyInput {
  externalAccountId: string;
  /** Provider-side post ID stored in `posts.external_id`. */
  postExternalId: string;
  /** Provider-side ID of the comment whose author is being written to. */
  commentExternalId: string;
  text: string;
}

export interface SendCommentPrivateReplyResult {
  /** External ID the provider assigned to the sent direct message. */
  providerMessageId: string;
}

/** Input to the optional provider lookup for one post's preview image. */
export interface FetchPostThumbnailInput {
  externalAccountId: string;
  /** Provider-side post ID stored in `posts.external_id`. */
  postExternalId: string;
}

export interface FetchPostThumbnailResult {
  thumbnailUrl: string | null;
}

/** Input to the optional `parseConnectCallback` — the query parameters the provider appended to the redirect. */
export interface ParseConnectCallbackInput {
  /** Query-string parameters of the provider's redirect back to us (keys as-is). */
  query: Record<string, string>;
}

/** Result of `parseConnectCallback` — what the callback route needs to create the `channel_connections` row. */
export interface ConnectCallbackResult {
  /**
   * External ID of the connected social account — must equal what the
   * provider reports as `externalAccountId` on inbound webhooks
   * (NormalizedEvent.externalAccountId), so (provider, externalAccountId)
   * keeps resolving the same connection.
   */
  externalAccountId: string;
  /** Platform the provider reports the account was connected for (cross-check against the pending state). */
  platform?: ChannelPlatform;
  /**
   * Display name / handle of the authorized account, when the provider
   * reports one. The connection is named after it — the user never types a
   * name (`lib/channels/labels.ts`, docs/architecture/05-channels.md).
   */
  accountUsername?: string;
  /**
   * Optional provider credentials/tokens to persist encrypted
   * (channel_connections.encrypted_credentials). Empty for Zernio — Zernio
   * holds the platform tokens; drafta only stores the account ID.
   */
  credentials?: Record<string, unknown>;
}

/**
 * The channel adapter interface — the four operations from
 * docs/architecture/05-channels.md#интерфейс-адаптера. Every provider under
 * `lib/channels/<provider>/` implements this; nothing outside that subfolder
 * may depend on provider specifics.
 */
export interface ChannelAdapter {
  readonly provider: ChannelProvider;

  /** Verify the raw webhook request's signature. */
  verifyWebhook(input: VerifyWebhookInput): boolean | Promise<boolean>;

  /**
   * Parse an already-verified raw webhook payload into normalized events —
   * and report the envelopes it could not normalize rather than dropping
   * them silently (see `ParseWebhookResult`).
   */
  parseWebhook(
    input: ParseWebhookInput,
  ): ParseWebhookResult | Promise<ParseWebhookResult>;

  /**
   * Send an outgoing message through the provider (stage 3 of the rollout
   * plan). Adapters whose send path is not configured/implemented reject
   * with `ChannelOperationNotImplementedError`.
   */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /**
   * Optional: start the provider's account-connect flow and return the
   * authorization URL to redirect the browser to (plus the provider-side
   * account-grouping id used). May call the provider's API, so it's async.
   */
  getConnectUrl?(input: GetConnectUrlInput): Promise<GetConnectUrlResult>;

  /**
   * Optional: turn the provider's connect-callback query parameters into the
   * connected account's external ID (and any credentials). Provider-specific
   * parsing lives here — not in the callback route — per vibecoding rule 4
   * (docs/architecture/05-channels.md#дисциплина). Paired with
   * `getConnectUrl`: a provider that offers a connect flow implements both.
   */
  parseConnectCallback?(
    input: ParseConnectCallbackInput,
  ): ConnectCallbackResult | Promise<ConnectCallbackResult>;

  /**
   * Optional: disconnect the account at the provider when the user deletes the
   * channel in drafta, so the provider stops holding the platform tokens and
   * stops sending webhooks for it. Providers whose disconnect is also a
   * removal (Zernio's `DELETE /v1/accounts/{accountId}`) do both here.
   * Idempotent: an account the provider no longer knows is a success.
   */
  disconnectAccount?(input: DisconnectAccountInput): Promise<void>;

  /** Optional provider lookup used outside the webhook request path. */
  fetchParticipantAvatar?(
    input: FetchParticipantAvatarInput,
  ): Promise<FetchParticipantAvatarResult>;

  /** Optional provider lookup used after a post/comment webhook, never in it. */
  fetchPostThumbnail?(
    input: FetchPostThumbnailInput,
  ): Promise<FetchPostThumbnailResult>;

  /**
   * Sends a private message to the author of a comment, where the platform
   * supports it (`ChannelCapabilities.supportsPrivateReply`). Optional: a
   * provider without the concept simply does not implement it.
   */
  sendCommentPrivateReply?(
    input: SendCommentPrivateReplyInput,
  ): Promise<SendCommentPrivateReplyResult>;
}

/**
 * Thrown by adapter operations that are declared by the interface but not
 * implemented (or not configured) for a given provider — e.g. `sendMessage`
 * on an adapter built without its REST config.
 */
export class ChannelOperationNotImplementedError extends Error {
  constructor(provider: ChannelProvider, operation: string) {
    super(
      `Channel operation "${operation}" is not implemented yet for provider "${provider}".`,
    );
    this.name = "ChannelOperationNotImplementedError";
  }
}
