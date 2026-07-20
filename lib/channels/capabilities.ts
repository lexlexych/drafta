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
  },
  whatsapp: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 4096,
    threadingStyle: "flat",
    supportsComments: false,
  },
  instagram: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 1000,
    threadingStyle: "parent",
    supportsComments: true,
  },
  facebook: {
    responseWindowHours: 24,
    supportsAttachments: true,
    supportsReadReceipts: true,
    maxMessageLength: 2000,
    threadingStyle: "parent",
    supportsComments: true,
  },
};

/** Returns a fresh copy of the platform's default capabilities (safe for the caller to mutate). */
export function getDefaultChannelCapabilities(
  platform: ChannelPlatform,
): ChannelCapabilities {
  return { ...DEFAULT_CHANNEL_CAPABILITIES[platform] };
}
