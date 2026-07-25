import "server-only";

import { NonRetriableError } from "inngest";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in the Inngest route's module graph.
import "@/lib/channels/zernio";

import { isNonRetriableSendError } from "./send-pipeline";

/**
 * Publishing one comment reply (docs/architecture/07-data-flows.md#63-отправка-ответа:
 * «для комментария — как ответ на конкретный комментарий»). Parallel to
 * `./send-pipeline.ts` but reading and writing the comment tables: the reply is
 * a `comments` row addressed to the post, with `parent_external_id` naming the
 * comment it answers.
 */

export type SendCommentPipelineInput = {
  workspaceId: string;
  postId: string;
  replyCommentId: string;
};

export type SendCommentPipelineResult =
  | { status: "sent"; providerCommentId: string }
  | {
      status: "skipped";
      reason:
        | "reply-not-found"
        | "not-outgoing"
        | "already-sent"
        | "not-pending"
        | "missing-parent"
        | "connection-inactive";
    };

export type SendCommentSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

export type LoadedCommentSendContext = {
  workspaceId: string;
  replyCommentId: string;
  text: string;
  provider: string;
  channelConnectionId: string;
  /** channel_connections.external_id — the provider-side account ID. */
  externalAccountId: string;
  /** posts.external_id — the provider-side post ID the reply is published under. */
  postExternalId: string;
  /** The provider ID of the comment being answered. */
  parentExternalId: string;
};

export type LoadCommentSendContextResult =
  | { status: "ok"; context: LoadedCommentSendContext }
  | {
      status: "skip";
      reason: Extract<SendCommentPipelineResult, { status: "skipped" }>["reason"];
    };

export type SendCommentDependencies = {
  loadContext(
    input: SendCommentPipelineInput,
  ): Promise<LoadCommentSendContextResult>;
  sendViaAdapter(context: LoadedCommentSendContext): Promise<string>;
  markSent(input: {
    workspaceId: string;
    replyCommentId: string;
    providerCommentId: string;
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
  input: SendCommentPipelineInput,
): Promise<LoadCommentSendContextResult> {
  const supabase = createAdminSupabaseClient();

  const { data: reply, error: replyError } = await supabase
    .from("comments")
    .select("id, direction, external_id, delivery_status, text, parent_external_id")
    .eq("workspace_id", input.workspaceId)
    .eq("post_id", input.postId)
    .eq("id", input.replyCommentId)
    .maybeSingle();
  assertQuerySucceeded(replyError, "Loading the outgoing reply");

  // The guards below are this pipeline's idempotency: a redelivered event or a
  // retried run for a reply that already went out must be a no-op.
  if (!reply) {
    return { status: "skip", reason: "reply-not-found" };
  }
  if (reply.direction !== "outgoing") {
    return { status: "skip", reason: "not-outgoing" };
  }
  if (reply.external_id !== null) {
    return { status: "skip", reason: "already-sent" };
  }
  if (reply.delivery_status !== "pending") {
    return { status: "skip", reason: "not-pending" };
  }
  if (!reply.parent_external_id) {
    // A comment reply must target a specific comment. Without it there is
    // nothing to publish against — a bug, not something a retry would fix.
    return { status: "skip", reason: "missing-parent" };
  }

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("external_id, channel_connection_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.postId)
    .maybeSingle();
  assertQuerySucceeded(postError, "Loading the reply's post");

  if (!post) {
    throw new Error("The reply's post is unavailable.");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("id, provider, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", post.channel_connection_id)
    .maybeSingle();
  assertQuerySucceeded(connectionError, "Loading the channel connection");

  if (!connection) {
    throw new Error("The post's channel connection is unavailable.");
  }
  if (connection.status !== "active") {
    return { status: "skip", reason: "connection-inactive" };
  }

  return {
    status: "ok",
    context: {
      workspaceId: input.workspaceId,
      replyCommentId: input.replyCommentId,
      text: reply.text,
      provider: connection.provider,
      channelConnectionId: connection.id,
      externalAccountId: connection.external_id,
      postExternalId: post.external_id,
      parentExternalId: reply.parent_external_id,
    },
  };
}

async function sendViaAdapter(
  context: LoadedCommentSendContext,
): Promise<string> {
  const adapter = resolveChannelAdapter(context.provider);
  const result = await adapter.sendMessage({
    channelConnectionId: context.channelConnectionId,
    externalAccountId: context.externalAccountId,
    conversationExternalId: context.postExternalId,
    text: context.text,
    interactionKind: "comment",
    parentExternalId: context.parentExternalId,
  });

  return result.providerMessageId;
}

async function markSent(input: {
  workspaceId: string;
  replyCommentId: string;
  providerCommentId: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("comments")
    .update({
      external_id: input.providerCommentId,
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.replyCommentId)
    .eq("delivery_status", "pending")
    .select("id")
    .maybeSingle();
  assertQuerySucceeded(error, "Marking the reply sent");

  if (!data) {
    // The provider already accepted the reply, so this stays a log rather than
    // a retry — a retry could not undo the publish anyway.
    console.error(
      "[send-comment] published reply was not pending anymore; provider id not recorded",
      { replyCommentId: input.replyCommentId },
    );
  }
}

/** Marks the reply `failed` — used by onFailure and by the compensating action. */
export async function markCommentSendFailed(input: {
  workspaceId: string;
  replyCommentId: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("comments")
    .update({ delivery_status: "failed", updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.replyCommentId)
    .eq("delivery_status", "pending");
  assertQuerySucceeded(error, "Marking the reply failed");
}

export const sendCommentDependencies: SendCommentDependencies = {
  loadContext,
  sendViaAdapter,
  markSent,
};

export async function runSendCommentPipeline(
  input: SendCommentPipelineInput,
  steps: SendCommentSteps,
  dependencies: SendCommentDependencies = sendCommentDependencies,
): Promise<SendCommentPipelineResult> {
  const loaded = await steps.run("load-context", () =>
    dependencies.loadContext(input),
  );
  if (loaded.status === "skip") {
    return { status: "skipped", reason: loaded.reason };
  }

  const providerCommentId = await steps.run("send-via-adapter", async () => {
    try {
      return await dependencies.sendViaAdapter(loaded.context);
    } catch (error) {
      if (isNonRetriableSendError(error)) {
        throw new NonRetriableError(
          error instanceof Error ? error.message : "Provider rejected the reply.",
          { cause: error },
        );
      }
      throw error;
    }
  });

  await steps.run("mark-sent", () =>
    dependencies.markSent({
      workspaceId: input.workspaceId,
      replyCommentId: input.replyCommentId,
      providerCommentId,
    }),
  );

  return { status: "sent", providerCommentId };
}
