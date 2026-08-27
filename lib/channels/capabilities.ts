import type { ChannelPlatform } from "./types";

/**
 * Capability differences between platforms — see
 * docs/architecture/05-channels.md#capabilities-канала. Stored as data (this
 * file, then copied into `channel_connections.capabilities` jsonb per
 * connection at creation time — see T-04), never branched on in code.
 */
export interface ChannelCapabilities {
  /** Hours after the last incoming message the platform allows a reply within; null = no such window. */
  responseWindowHours: number | null;
  supportsAttachments: boolean;
  supportsReadReceipts: boolean;
  /** Max message length in characters; null = no known hard limit. */
  maxMessageLength: number | null;
  /** How replies thread: not at all, by parent ID, or by email headers. */
  threadingStyle: "flat" | "parent" | "email-headers";
  supportsComments: boolean;
  /**
   * Whether the platform lets us DM the author of a comment without an existing
   * thread (Meta's «private reply»). One per comment, within
   * `privateReplyWindowHours` of the comment.
   */
  supportsPrivateReply: boolean;
  /** Hours after a comment the private reply is allowed; null = not supported. */
  privateReplyWindowHours: number | null;
}

/**
 * Default capabilities per platform.
 *
 * Assumptions (no live Zernio/Meta integration yet — E-002 open question #1
 * in docs/epics/epic_02/_index.md; to be reconciled with real payloads in
 * T-07):
 * - WhatsApp's 24h response window is explicit in
 *   docs/architecture/05-channels.md#capabilities-канала.
 * - Instagram and Facebook Messenger are assumed to follow Meta's standard
 *   24h messaging window, same as WhatsApp.
 * - Telegram bots have no platform-enforced response window.
 * - Message length limits are the platforms' published text limits.
 * - Comment support: only Instagram and Facebook have a comments concept in
 *   this product (Telegram/WhatsApp are DM-only platforms here).
 * - Private replies are Instagram/Facebook only and expire 7 days after the
 *   comment — both stated by Zernio's `sendPrivateReplyToComment`
 *   (docs.zernio.com/api/openapi), which surfaces Meta's own rule.
 */
export const DEFAULT_CHANNEL_CAPABILITIES: Readonly<
  Record<ChannelPlatform, ChannelCapabilities>
> = {
  telegram: {
    responseWindowHours: null,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 4096,
    threadingStyle: "flat",
    supportsComments: false,
    supportsPrivateReply: false,
    privateReplyWindowHours: null,
  },
  whatsapp: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 4096,
    threadingStyle: "flat",
    supportsComments: false,
    supportsPrivateReply: false,
    privateReplyWindowHours: null,
  },
  instagram: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 1000,
    threadingStyle: "parent",
    supportsComments: true,
    supportsPrivateReply: true,
    privateReplyWindowHours: 24 * 7,
  },
  facebook: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 2000,
    threadingStyle: "parent",
    supportsComments: true,
    supportsPrivateReply: true,
    privateReplyWindowHours: 24 * 7,
  },
};

/** Returns a fresh copy of the platform's default capabilities (safe for the caller to mutate). */
export function getDefaultChannelCapabilities(
  platform: ChannelPlatform,
): ChannelCapabilities {
  return { ...DEFAULT_CHANNEL_CAPABILITIES[platform] };
}

function isChannelPlatform(value: unknown): value is ChannelPlatform {
  return (
    value === "telegram" ||
    value === "whatsapp" ||
    value === "instagram" ||
    value === "facebook"
  );
}

/**
 * Reads `channel_connections.capabilities` — a jsonb snapshot taken when the
 * account was connected — falling back to the platform's current defaults field
 * by field.
 *
 * The per-field fallback is what makes adding a capability safe: rows written
 * before it existed simply do not carry the key, and would otherwise come back
 * `undefined` and read as "not supported".
 *
 * Throws on an unknown platform: that is a corrupted row, not a missing
 * capability, and guessing a platform would be worse than failing.
 */
export function resolveChannelCapabilities(
  platformValue: unknown,
  storedValue: unknown,
): ChannelCapabilities {
  if (!isChannelPlatform(platformValue)) {
    throw new Error("Channel platform is unsupported.");
  }

  const defaults = getDefaultChannelCapabilities(platformValue);
  if (typeof storedValue !== "object" || storedValue === null) {
    return defaults;
  }

  const stored = storedValue as Partial<ChannelCapabilities>;
  return {
    responseWindowHours:
      stored.responseWindowHours === null ||
      typeof stored.responseWindowHours === "number"
        ? stored.responseWindowHours
        : defaults.responseWindowHours,
    supportsAttachments:
      typeof stored.supportsAttachments === "boolean"
        ? stored.supportsAttachments
        : defaults.supportsAttachments,
    supportsReadReceipts:
      typeof stored.supportsReadReceipts === "boolean"
        ? stored.supportsReadReceipts
        : defaults.supportsReadReceipts,
    maxMessageLength:
      stored.maxMessageLength === null ||
      typeof stored.maxMessageLength === "number"
        ? stored.maxMessageLength
        : defaults.maxMessageLength,
    threadingStyle:
      stored.threadingStyle === "flat" ||
      stored.threadingStyle === "parent" ||
      stored.threadingStyle === "email-headers"
        ? stored.threadingStyle
        : defaults.threadingStyle,
    supportsComments:
      typeof stored.supportsComments === "boolean"
        ? stored.supportsComments
        : defaults.supportsComments,
    supportsPrivateReply:
      typeof stored.supportsPrivateReply === "boolean"
        ? stored.supportsPrivateReply
        : defaults.supportsPrivateReply,
    privateReplyWindowHours:
      stored.privateReplyWindowHours === null ||
      typeof stored.privateReplyWindowHours === "number"
        ? stored.privateReplyWindowHours
        : defaults.privateReplyWindowHours,
  };
}
