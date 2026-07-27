import type { ChannelPlatform } from "./types";

/**
 * Human-readable platform names and the auto-naming rule for a freshly
 * connected channel.
 *
 * Provider-agnostic on purpose (lives at the `lib/channels/` root, imports no
 * provider code — vibecoding rule 4) and free of `server-only`, so both the
 * connect callback route and the Settings → Channels client panel use the
 * same wording.
 */

export const CHANNEL_PLATFORM_LABELS: Readonly<Record<ChannelPlatform, string>> = {
  instagram: "Instagram",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
};

/**
 * Name for a just-connected channel. The user no longer types one: the
 * connection is named after the authorized account (the provider reports it
 * in the connect callback — for Zernio that's `username`), and can be renamed
 * later in Settings → Channels. Falls back to the platform label when the
 * provider reports no account name, so `channel_connections.name` (NOT NULL,
 * non-blank) always has a value.
 */
export function buildChannelConnectionName(
  platform: ChannelPlatform,
  accountUsername?: string | null,
): string {
  const trimmed = accountUsername?.trim();

  return trimmed ? trimmed : CHANNEL_PLATFORM_LABELS[platform];
}
