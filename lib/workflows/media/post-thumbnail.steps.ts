import "server-only";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Регистрирует адаптер провайдера в графе модулей этого шага.
import "@/lib/channels/zernio";

export type PostThumbnailInput = {
  workspaceId: string;
  postId: string;
};

export type PostThumbnailResult =
  | { status: "updated" | "unavailable" }
  | {
      status: "skipped";
      reason:
        | "post-not-found"
        | "already-present"
        | "connection-unavailable"
        | "connection-inactive"
        | "provider-unsupported";
    };

export type LoadedPostThumbnailContext = {
  provider: string;
  externalAccountId: string;
  postExternalId: string;
};

type SkipReason = Extract<PostThumbnailResult, { status: "skipped" }>["reason"];

export type LoadPostThumbnailContextResult =
  | { status: "ok"; context: LoadedPostThumbnailContext }
  | { status: "skip"; reason: SkipReason };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) return;
  throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
}

export async function loadPostThumbnailContext(
  input: PostThumbnailInput,
): Promise<LoadPostThumbnailContextResult> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("external_id, thumbnail_url, channel_connection_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.postId)
    .maybeSingle();
  assertQuerySucceeded(postError, "Loading the post thumbnail context");
  if (!post) return { status: "skip", reason: "post-not-found" };
  if (post.thumbnail_url) {
    return { status: "skip", reason: "already-present" };
  }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("provider, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", post.channel_connection_id)
    .maybeSingle();
  assertQuerySucceeded(connectionError, "Loading the post channel connection");
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
      postExternalId: post.external_id,
    },
  };
}
loadPostThumbnailContext.maxRetries = 2;

export async function fetchAndSavePostThumbnail(input: {
  workflowInput: PostThumbnailInput;
  context: LoadedPostThumbnailContext;
}): Promise<"updated" | "unavailable" | "provider-unsupported"> {
  "use step";

  const adapter = resolveChannelAdapter(input.context.provider);
  if (!adapter.fetchPostThumbnail) {
    return "provider-unsupported";
  }

  const result = await adapter.fetchPostThumbnail({
    externalAccountId: input.context.externalAccountId,
    postExternalId: input.context.postExternalId,
  });
  if (!result.thumbnailUrl) {
    return "unavailable";
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("posts")
    .update({
      thumbnail_url: result.thumbnailUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workflowInput.workspaceId)
    .eq("id", input.workflowInput.postId)
    .is("thumbnail_url", null);
  assertQuerySucceeded(error, "Saving the post thumbnail");

  return "updated";
}
fetchAndSavePostThumbnail.maxRetries = 2;
