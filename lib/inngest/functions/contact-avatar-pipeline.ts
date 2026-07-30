import "server-only";

import { isAvatarStale } from "@/lib/avatars";
import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Side-effect import: registers the Zernio adapter so `resolveChannelAdapter`
// works in the Inngest route's module graph, same as the send pipelines do.
import "@/lib/channels/zernio";

export type ContactAvatarPipelineInput = {
  workspaceId: string;
  contactIdentityId: string;
  channelConnectionId: string;
  /** Set when a comment triggered the sync — the post to look the author up in. */
  postId?: string;
};

export type ContactAvatarPipelineResult =
  | { status: "updated"; avatarUrl: string }
  | {
      status: "skipped";
      reason:
        | "identity-not-found"
        | "still-fresh"
        | "connection-unavailable"
        | "connection-inactive";
    }
  /** Asked the provider, and either found nothing or the same URL we already had. */
  | { status: "unchanged" };

export type ContactAvatarSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

/** Everything the adapter call needs, resolved once by `load-context`. */
export type LoadedAvatarContext = {
  provider: string;
  externalAccountId: string;
  participantExternalId: string;
  postExternalId?: string;
  currentAvatarUrl: string | null;
};

export type LoadAvatarContextResult =
  | { status: "ok"; context: LoadedAvatarContext }
  | {
      status: "skip";
      reason: Extract<ContactAvatarPipelineResult, { status: "skipped" }>["reason"];
    };

export type ContactAvatarDependencies = {
  loadContext(
    input: ContactAvatarPipelineInput,
    nowIso: string,
  ): Promise<LoadAvatarContextResult>;
  /** Asks the channel adapter for the picture; `null` when the platform has none. */
  fetchAvatar(context: LoadedAvatarContext): Promise<string | null>;
  /**
   * Records the outcome. `avatarUrl: null` means "asked, found nothing" — the
   * stored URL is left alone, only the timestamp moves.
   */
  saveAvatar(input: {
    workspaceId: string;
    contactIdentityId: string;
    avatarUrl: string | null;
    fetchedAtIso: string;
  }): Promise<void>;
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

async function loadContext(
  input: ContactAvatarPipelineInput,
  nowIso: string,
): Promise<LoadAvatarContextResult> {
  const supabase = createAdminSupabaseClient();

  const { data: identity, error: identityError } = await supabase
    .from("contact_identities")
    .select("id, external_id, avatar_url, avatar_fetched_at")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.contactIdentityId)
    .maybeSingle();
  assertQuerySucceeded(identityError, "Loading the contact identity");

  if (!identity) {
    return { status: "skip", reason: "identity-not-found" };
  }

  // The TTL is re-checked here, not only at the emission point: events can be
  // redelivered, and two messages arriving together each see the pre-update
  // row. This is what keeps "at most one call a month" true.
  if (!isAvatarStale(identity.avatar_fetched_at, nowIso)) {
    return { status: "skip", reason: "still-fresh" };
  }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("provider, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.channelConnectionId)
    .maybeSingle();
  assertQuerySucceeded(connectionError, "Loading the channel connection");

  if (!connection) {
    return { status: "skip", reason: "connection-unavailable" };
  }
  if (connection.status !== "active") {
    return { status: "skip", reason: "connection-inactive" };
  }

  let postExternalId: string | undefined;
  if (input.postId) {
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("external_id")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.postId)
      .maybeSingle();
    assertQuerySucceeded(postError, "Loading the commented post");

    if (!post) {
      // The post is gone (channel deleted, cascade) — nothing to look the
      // author up in, and a DM-style lookup would search the wrong listing.
      return { status: "skip", reason: "identity-not-found" };
    }
    postExternalId = post.external_id;
  }

  return {
    status: "ok",
    context: {
      provider: connection.provider,
      externalAccountId: connection.external_id,
      participantExternalId: identity.external_id,
      ...(postExternalId ? { postExternalId } : {}),
      currentAvatarUrl: identity.avatar_url,
    },
  };
}

async function fetchAvatar(context: LoadedAvatarContext): Promise<string | null> {
  const adapter = resolveChannelAdapter(context.provider);

  if (!adapter.fetchParticipantAvatar) {
    // Optional operation — a provider without it simply never shows photos.
    return null;
  }

  const { avatarUrl } = await adapter.fetchParticipantAvatar({
    externalAccountId: context.externalAccountId,
    participantExternalId: context.participantExternalId,
    ...(context.postExternalId ? { postExternalId: context.postExternalId } : {}),
  });

  return avatarUrl;
}

async function saveAvatar(input: {
  workspaceId: string;
  contactIdentityId: string;
  avatarUrl: string | null;
  fetchedAtIso: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();

  // The timestamp moves on every attempt, the URL only when we found one:
  // a platform that reports no picture must not wipe an older working one,
  // but it also must not make us ask again on the contact's next message.
  const { error } = await supabase
    .from("contact_identities")
    .update({
      ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
      avatar_fetched_at: input.fetchedAtIso,
      updated_at: input.fetchedAtIso,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.contactIdentityId);
  assertQuerySucceeded(error, "Saving the contact avatar");
}

export const contactAvatarDependencies: ContactAvatarDependencies = {
  loadContext,
  fetchAvatar,
  saveAvatar,
};

/**
 * Fetches one contact's profile picture from the channel provider and stores
 * the URL (never the bytes — see `app/api/avatars/[identityId]/route.ts`).
 *
 * Runs off `contact/avatar.sync-requested`, which the webhook pipeline emits
 * when a contact writes and their avatar is stale. Vibecoding rule 8: the call
 * to the provider happens here, with retries, never inside the webhook request.
 */
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

  const avatarUrl = await steps.run("fetch-avatar", () =>
    dependencies.fetchAvatar(loaded.context),
  );

  await steps.run("save-avatar", () =>
    dependencies.saveAvatar({
      workspaceId: input.workspaceId,
      contactIdentityId: input.contactIdentityId,
      avatarUrl,
      fetchedAtIso: nowIso,
    }),
  );

  return avatarUrl && avatarUrl !== loaded.context.currentAvatarUrl
    ? { status: "updated", avatarUrl }
    : { status: "unchanged" };
}
