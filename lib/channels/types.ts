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
  | "message.delivered"
  | "message.read"
  | "message.failed"
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
 * The post a comment belongs to, or a newly published one. `externalId` is the
 * provider-side post ID — the key `posts.external_id` stores, and the value a
 * later comment on the same post reports. Everything else is optional: the
 * comment webhook carries IDs only, while a publish webhook usually also has
 * the caption and a link.
 */
export interface NormalizedPostRef {
  externalId: string;
  /** Caption/body of the post, when the provider reports it. */
  text?: string;
  /** Public link to the post, when the provider reports one. */
  permalink?: string;
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
}

/** One page of provider participants used by the periodic avatar backfill. */
export interface ListParticipantAvatarsInput {
  externalAccountId: string;
  cursor?: string;
  limit?: number;
}

export interface ParticipantAvatar {
  participantExternalId: string;
  avatarUrl: string | null;
}

export interface ListParticipantAvatarsResult {
  participants: ParticipantAvatar[];
  nextCursor: string | null;
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

  /** Parse an already-verified raw webhook payload into normalized events. */
  parseWebhook(
    input: ParseWebhookInput,
  ): NormalizedEvent[] | Promise<NormalizedEvent[]>;

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

  /** Optional paginated listing used by the scheduled avatar refresh. */
  listParticipantAvatars?(
    input: ListParticipantAvatarsInput,
  ): Promise<ListParticipantAvatarsResult>;
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
