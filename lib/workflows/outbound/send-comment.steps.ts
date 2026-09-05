import "server-only";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { rethrowAsWorkflowSendError } from "@/lib/workflows/send-errors";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in this step's module graph.
import "@/lib/channels/zernio";

/**
 * Publishing one comment reply (docs/architecture/07-data-flows.md#63-отправка-ответа:
 * «для комментария — как ответ на конкретный комментарий»). Parallel to
 * `./send-message.steps.ts` but reading and writing the comment tables: the reply is
 * a `comments` row addressed to the post, with `parent_external_id` naming the
 * comment it answers.
 */

export type SendCommentInput = {
  workspaceId: string;
  postId: string;
  replyCommentId: string;
};

export type SendCommentResult =
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
      reason: Extract<SendCommentResult, { status: "skipped" }>["reason"];
    };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

export async function loadCommentSendContext(
  input: SendCommentInput,
): Promise<LoadCommentSendContextResult> {
  "use step";

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

async function publishThroughProvider(
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

export async function markCommentSent(input: {
  workspaceId: string;
  replyCommentId: string;
  providerCommentId: string;
}): Promise<void> {
  "use step";

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

/**
 * Единственный внешний вызов прогона. 4xx (кроме 408/429) становится
 * `FatalError`: повторять бессмысленно, компенсация пометит ответ `failed`.
 */
export async function sendCommentViaAdapter(
  context: LoadedCommentSendContext,
): Promise<string> {
  "use step";

  try {
    return await publishThroughProvider(context);
  } catch (error) {
    rethrowAsWorkflowSendError(error);
  }
}
sendCommentViaAdapter.maxRetries = 4;

/**
 * Помечает ответ `failed`. Вызывается компенсацией в теле прогона (бывший
 * `onFailure`) и компенсирующим серверным действием. Условие `pending` не даёт
 * понизить ответ, который уже успел стать `sent`.
 *
 * Без директивы: её зовут и из прогона (через `markCommentSendFailedStep`), и
 * из обычного запроса, где workflow-контекста нет.
 */
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

/** Шаг-обёртка над компенсацией: откат такой же durable, как и работа. */
export async function markCommentSendFailedStep(input: {
  workspaceId: string;
  replyCommentId: string;
}): Promise<void> {
  "use step";

  await markCommentSendFailed(input);
}

loadCommentSendContext.maxRetries = 4;
markCommentSent.maxRetries = 4;
