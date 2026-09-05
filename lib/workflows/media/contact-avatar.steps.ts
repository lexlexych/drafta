import "server-only";

import { isAvatarStale } from "@/lib/avatars";
import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Регистрирует адаптер провайдера в графе модулей этого шага.
import "@/lib/channels/zernio";

export type ContactAvatarInput = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};

export type ContactAvatarResult =
  | { status: "updated" | "unchanged" }
  | {
      status: "skipped";
      reason:
        | "identity-not-found"
        | "still-fresh"
        | "conversation-not-found"
        | "connection-unavailable"
        | "connection-inactive";
    };

export type LoadedAvatarContext = {
  provider: string;
  externalAccountId: string;
  participantExternalId: string;
  conversationExternalId: string;
  currentAvatarUrl: string | null;
};

type SkipReason = Extract<ContactAvatarResult, { status: "skipped" }>["reason"];

export type LoadAvatarContextResult =
  | { status: "ok"; context: LoadedAvatarContext }
  | { status: "skip"; reason: SkipReason };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) return;
  throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
}

export async function loadAvatarContext(
  input: ContactAvatarInput,
  nowIso: string,
): Promise<LoadAvatarContextResult> {
  "use step";

  const supabase = createAdminSupabaseClient();

  const { data: identity, error: identityError } = await supabase
    .from("contact_identities")
    .select("external_id, avatar_url, avatar_fetched_at")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.contactIdentityId)
    .maybeSingle();
  assertQuerySucceeded(identityError, "Loading the contact identity");
  if (!identity) return { status: "skip", reason: "identity-not-found" };
  if (!isAvatarStale(identity.avatar_fetched_at, new Date(nowIso))) {
    return { status: "skip", reason: "still-fresh" };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("external_id, channel_connection_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();
  assertQuerySucceeded(conversationError, "Loading the conversation");
  if (!conversation) {
    return { status: "skip", reason: "conversation-not-found" };
  }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("provider, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", conversation.channel_connection_id)
    .maybeSingle();
  assertQuerySucceeded(connectionError, "Loading the channel connection");
  if (!connection) {
    return { status: "skip", reason: "connection-unavailable" };
  }
  if (connection.status !== "active") {
    return { status: "skip", reason: "connection-inactive" };
  }

  return {
    status: "ok",
    context: {
      provider: connection.provider,
      externalAccountId: connection.external_id,
      participantExternalId: identity.external_id,
      conversationExternalId: conversation.external_id,
      currentAvatarUrl: identity.avatar_url,
    },
  };
}
loadAvatarContext.maxRetries = 2;

export async function fetchAndSaveAvatar(input: {
  workflowInput: ContactAvatarInput;
  context: LoadedAvatarContext;
  fetchedAtIso: string;
}): Promise<{ changed: boolean }> {
  "use step";

  const adapter = resolveChannelAdapter(input.context.provider);
  const result = adapter.fetchParticipantAvatar
    ? await adapter.fetchParticipantAvatar({
        externalAccountId: input.context.externalAccountId,
        participantExternalId: input.context.participantExternalId,
        conversationExternalId: input.context.conversationExternalId,
      })
    : { avatarUrl: null, found: false };

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("contact_identities")
    .update({
      ...(result.avatarUrl ? { avatar_url: result.avatarUrl } : {}),
      avatar_fetched_at: input.fetchedAtIso,
      updated_at: input.fetchedAtIso,
    })
    .eq("workspace_id", input.workflowInput.workspaceId)
    .eq("id", input.workflowInput.contactIdentityId);
  assertQuerySucceeded(error, "Saving the contact avatar");

  return {
    changed:
      result.avatarUrl !== null &&
      result.avatarUrl !== input.context.currentAvatarUrl,
  };
}
fetchAndSaveAvatar.maxRetries = 2;
