import "server-only";

import { resolveChannelAdapter } from "./registry";

// Registers the server-side provider adapters used by this operation.
import "./zernio";

export type ChannelParticipantAvatarLookup = {
  supported: boolean;
  found: boolean;
  avatarUrl: string | null;
};

/** Provider-agnostic boundary for an explicit server-side avatar refresh. */
export async function fetchChannelParticipantAvatar(input: {
  provider: string;
  externalAccountId: string;
  participantExternalId: string;
  conversationExternalId?: string;
}): Promise<ChannelParticipantAvatarLookup> {
  const adapter = resolveChannelAdapter(input.provider);
  if (!adapter.fetchParticipantAvatar) {
    return { supported: false, found: false, avatarUrl: null };
  }

  const result = await adapter.fetchParticipantAvatar({
    externalAccountId: input.externalAccountId,
    participantExternalId: input.participantExternalId,
    conversationExternalId: input.conversationExternalId,
  });

  return { supported: true, ...result };
}
