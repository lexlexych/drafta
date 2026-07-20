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
  | "comment.received"
  | "message.delivered"
  | "message.read"
  | "message.failed";

/** Whether the event is a direct message or a comment on a post. */
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
}

/** The message or comment body carried by the event. */
export interface NormalizedMessage {
  /**
   * External ID of the message/comment at the provider — together with the
   * conversation, this is the `messages` table's idempotency key.
   */
  externalId: string;
  text: string;
  attachments: NormalizedAttachment[];
  sender: NormalizedSender;
}

/** Reference to the DM thread, or to the post a comment belongs to. */
export interface NormalizedConversationRef {
  /** External ID of the DM thread, or of the post for comment events. */
  externalId: string;
  /**
   * Post metadata for comment events (external post ID, preview text,
   * link…). Absent for DM events.
   */
  postMetadata?: Record<string, unknown>;
}

/**
 * A single provider webhook payload normalizes to zero or more of these.
 * This is the contract every adapter's `parseWebhook` must produce, and the
 * one every consumer downstream of `lib/channels` (webhook route, inbox)
 * relies on — see docs/architecture/05-channels.md#нормализованное-событие.
 */
export interface NormalizedEvent {
  type: NormalizedEventType;
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
  interactionKind: InteractionKind;
  conversation: NormalizedConversationRef;
  message: NormalizedMessage;
  /**
   * Raw provider metadata for this event, kept in full — nothing gets lost
   * even where the normalized fields above are incomplete (email headers,
   * parent post/comment IDs, etc).
   */
  rawMetadata: Record<string, unknown>;
}

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

/** Input to `sendMessage` — see docs/architecture/05-channels.md; implemented starting stage 3 of the rollout plan. */
export interface SendMessageInput {
  channelConnectionId: string;
  conversationExternalId: string;
  text: string;
  attachments?: NormalizedAttachment[];
}

export interface SendMessageResult {
  /** External ID the provider assigned to the sent message. */
  providerMessageId: string;
}

/** Input to the optional `getConnectUrl` — a link that starts the provider's account-connect flow. */
export interface GetConnectUrlInput {
  workspaceId: string;
  /** Platform the user is connecting — the provider's connect page needs it up front. */
  platform: ChannelPlatform;
  /** Absolute URL the provider must redirect the browser back to once the account is authorized. */
  redirectUrl: string;
  /** Opaque, signed anti-CSRF token round-tripped through the provider back to `parseConnectCallback`'s caller. */
  state: string;
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
   * Send an outgoing message. Declared now so the adapter contract is
   * complete, but not implemented before stage 3 of the rollout plan —
   * adapters must reject with `ChannelOperationNotImplementedError` until
   * then (see docs/architecture/16-rollout-plan.md).
   */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /** Optional: a link that starts the provider's account-connect flow. */
  getConnectUrl?(input: GetConnectUrlInput): string | Promise<string>;

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
}

/**
 * Thrown by adapter operations that are declared by the interface but not
 * implemented yet for a given provider (currently only `sendMessage`, before
 * stage 3 — see docs/architecture/16-rollout-plan.md).
 */
export class ChannelOperationNotImplementedError extends Error {
  constructor(provider: ChannelProvider, operation: string) {
    super(
      `Channel operation "${operation}" is not implemented yet for provider "${provider}".`,
    );
    this.name = "ChannelOperationNotImplementedError";
  }
}
