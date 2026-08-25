import "server-only";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Registers the provider adapter in this Inngest module graph.
import "@/lib/channels/zernio";

export type PostThumbnailPipelineInput = {
  workspaceId: string;
  postId: string;
};

export type PostThumbnailPipelineResult =
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

export type PostThumbnailSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

export type LoadedPostThumbnailContext = {
  provider: string;
  externalAccountId: string;
  postExternalId: string;
};

type SkipReason = Extract<
  PostThumbnailPipelineResult,
  { status: "skipped" }
>["reason"];

export type LoadPostThumbnailContextResult =
  | { status: "ok"; context: LoadedPostThumbnailContext }
  | { status: "skip"; reason: SkipReason };

export type PostThumbnailDependencies = {
  loadContext(
    input: PostThumbnailPipelineInput,
  ): Promise<LoadPostThumbnailContextResult>;
  fetchAndSaveThumbnail(input: {
    pipelineInput: PostThumbnailPipelineInput;
    context: LoadedPostThumbnailContext;
  }): Promise<"updated" | "unavailable" | "provider-unsupported">;
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) return;
  throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
}

async function loadContext(
  input: PostThumbnailPipelineInput,
): Promise<LoadPostThumbnailContextResult> {
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

async function fetchAndSaveThumbnail(input: {
  pipelineInput: PostThumbnailPipelineInput;
  context: LoadedPostThumbnailContext;
}): Promise<"updated" | "unavailable" | "provider-unsupported"> {
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
    .eq("workspace_id", input.pipelineInput.workspaceId)
    .eq("id", input.pipelineInput.postId)
    .is("thumbnail_url", null);
  assertQuerySucceeded(error, "Saving the post thumbnail");

  return "updated";
}

export const postThumbnailDependencies: PostThumbnailDependencies = {
  loadContext,
  fetchAndSaveThumbnail,
};

export async function runPostThumbnailPipeline(
  input: PostThumbnailPipelineInput,
  steps: PostThumbnailSteps,
  dependencies: PostThumbnailDependencies = postThumbnailDependencies,
): Promise<PostThumbnailPipelineResult> {
  const loaded = await steps.run("load-context", () =>
    dependencies.loadContext(input),
  );
  if (loaded.status === "skip") {
    return { status: "skipped", reason: loaded.reason };
  }

  const result = await steps.run("fetch-and-save-thumbnail", () =>
    dependencies.fetchAndSaveThumbnail({
      pipelineInput: input,
      context: loaded.context,
    }),
  );
  if (result === "provider-unsupported") {
    return { status: "skipped", reason: result };
  }

  return { status: result };
}
