import "server-only";

import { isAvatarStale } from "@/lib/avatars";
import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Registers the provider adapter in this Inngest module graph.
import "@/lib/channels/zernio";

export type ContactAvatarPipelineInput = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};

export type ContactAvatarPipelineResult =
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

export type ContactAvatarSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

export type LoadedAvatarContext = {
  provider: string;
  externalAccountId: string;
  participantExternalId: string;
  conversationExternalId: string;
  currentAvatarUrl: string | null;
};

type SkipReason = Extract<
  ContactAvatarPipelineResult,
  { status: "skipped" }
>["reason"];

export type LoadAvatarContextResult =
  | { status: "ok"; context: LoadedAvatarContext }
  | { status: "skip"; reason: SkipReason };

export type ContactAvatarDependencies = {
  loadContext(
    input: ContactAvatarPipelineInput,
    nowIso: string,
  ): Promise<LoadAvatarContextResult>;
  fetchAndSaveAvatar(input: {
    pipelineInput: ContactAvatarPipelineInput;
    context: LoadedAvatarContext;
    fetchedAtIso: string;
  }): Promise<{ changed: boolean }>;
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) return;
  throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
}

async function loadContext(
  input: ContactAvatarPipelineInput,
  nowIso: string,
): Promise<LoadAvatarContextResult> {
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

async function fetchAndSaveAvatar(input: {
  pipelineInput: ContactAvatarPipelineInput;
  context: LoadedAvatarContext;
  fetchedAtIso: string;
}): Promise<{ changed: boolean }> {
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
    .eq("workspace_id", input.pipelineInput.workspaceId)
    .eq("id", input.pipelineInput.contactIdentityId);
  assertQuerySucceeded(error, "Saving the contact avatar");

  return {
    changed:
      result.avatarUrl !== null &&
      result.avatarUrl !== input.context.currentAvatarUrl,
  };
}

export const contactAvatarDependencies: ContactAvatarDependencies = {
  loadContext,
  fetchAndSaveAvatar,
};

export async function runContactAvatarPipeline(
  input: ContactAvatarPipelineInput,
  steps: ContactAvatarSteps,
  dependencies: ContactAvatarDependencies = contactAvatarDependencies,
): Promise<ContactAvatarPipelineResult> {
  const nowIso = await steps.run("capture-now", () => new Date().toISOString());
  const loaded = await steps.run("load-context", () =>
    dependencies.loadContext(input, nowIso),
  );
  if (loaded.status === "skip") {
    return { status: "skipped", reason: loaded.reason };
  }

  const result = await steps.run("fetch-and-save-avatar", () =>
    dependencies.fetchAndSaveAvatar({
      pipelineInput: input,
      context: loaded.context,
      fetchedAtIso: nowIso,
    }),
  );

  return { status: result.changed ? "updated" : "unchanged" };
}
