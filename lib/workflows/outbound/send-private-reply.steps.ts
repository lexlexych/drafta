import "server-only";

import { FatalError } from "workflow";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { rethrowAsWorkflowSendError } from "@/lib/workflows/send-errors";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in the this step's module graph.
import "@/lib/channels/zernio";

/**
 * Отправка личного сообщения автору комментария — Meta private reply.
 *
 * Отличается от `./send-comment-pipeline.ts` не только эндпоинтом: сообщение
 * адресовано комментарию, а не треду, и именно поэтому доходит до человека, с
 * которым переписки ещё нет. Сам тред появится в drafta позже — вебхуками
 * `conversation.started` / `message.sent`, а не отсюда.
 *
 * Отказ платформы («окно 7 дней закрыто», «уже отвечали», «платформа не
 * поддерживает») приходит как 400 и превращается в `FatalError`: это
 * окончательный ответ, ретраи его не изменят.
 */

export type SendCommentPrivateReplyInput = {
  workspaceId: string;
  postId: string;
  privateReplyId: string;
};

export type SendCommentPrivateReplyResult =
  | { status: "sent"; providerMessageId: string }
  | {
      status: "skipped";
      reason:
        | "private-reply-not-found"
        | "already-sent"
        | "not-pending"
        | "comment-unavailable"
        | "connection-inactive"
        | "provider-unsupported";
    };

export type LoadedPrivateReplyContext = {
  workspaceId: string;
  privateReplyId: string;
  text: string;
  provider: string;
  /** channel_connections.external_id — the provider-side account ID. */
  externalAccountId: string;
  /** posts.external_id — the provider-side post the comment sits under. */
  postExternalId: string;
  /** comments.external_id — the comment whose author is being written to. */
  commentExternalId: string;
};

export type LoadPrivateReplyContextResult =
  | { status: "ok"; context: LoadedPrivateReplyContext }
  | {
      status: "skip";
      reason: Extract<
        SendCommentPrivateReplyResult,
        { status: "skipped" }
      >["reason"];
    };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

export async function loadPrivateReplyContext(
  input: SendCommentPrivateReplyInput,
): Promise<LoadPrivateReplyContextResult> {
  "use step";

  const supabase = createAdminSupabaseClient();

  const { data: privateReply, error: privateReplyError } = await supabase
    .from("comment_private_replies")
    .select("id, comment_id, status, external_id, text")
    .eq("workspace_id", input.workspaceId)
    .eq("post_id", input.postId)
    .eq("id", input.privateReplyId)
    .maybeSingle();
  assertQuerySucceeded(privateReplyError, "Loading the private reply");

  // Эти проверки и есть идемпотентность: повторное событие или ретрай уже
  // доставленного сообщения обязаны быть no-op — второй раз человеку писать
  // нельзя ни по правилам Meta, ни по здравому смыслу.
  if (!privateReply) {
    return { status: "skip", reason: "private-reply-not-found" };
  }
  if (privateReply.external_id !== null) {
    return { status: "skip", reason: "already-sent" };
  }
  if (privateReply.status !== "pending") {
    return { status: "skip", reason: "not-pending" };
  }

  const { data: comment, error: commentError } = await supabase
    .from("comments")
    .select("id, external_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", privateReply.comment_id)
    .maybeSingle();
  assertQuerySucceeded(commentError, "Loading the answered comment");

  if (!comment?.external_id) {
    // Без провайдерского id комментария адресовать сообщение некому.
    return { status: "skip", reason: "comment-unavailable" };
  }

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("external_id, channel_connection_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.postId)
    .maybeSingle();
  assertQuerySucceeded(postError, "Loading the comment's post");

  if (!post) {
    throw new Error("The comment's post is unavailable.");
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
      privateReplyId: input.privateReplyId,
      text: privateReply.text,
      provider: connection.provider,
      externalAccountId: connection.external_id,
      postExternalId: post.external_id,
      commentExternalId: comment.external_id,
    },
  };
}

async function deliverThroughProvider(
  context: LoadedPrivateReplyContext,
): Promise<string> {
  const adapter = resolveChannelAdapter(context.provider);

  if (!adapter.sendCommentPrivateReply) {
    // Провайдер без private reply — окончательный отказ, а не сбой связи.
    throw new FatalError(
      `Provider "${context.provider}" does not support private replies.`,
    );
  }

  const result = await adapter.sendCommentPrivateReply({
    externalAccountId: context.externalAccountId,
    postExternalId: context.postExternalId,
    commentExternalId: context.commentExternalId,
    text: context.text,
  });

  return result.providerMessageId;
}

export async function markPrivateReplySent(input: {
  workspaceId: string;
  privateReplyId: string;
  providerMessageId: string;
}): Promise<void> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("comment_private_replies")
    .update({ external_id: input.providerMessageId, status: "sent" })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.privateReplyId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  assertQuerySucceeded(error, "Marking the private reply sent");

  if (!data) {
    // Провайдер сообщение уже принял — ретрай его не отменит, поэтому здесь
    // только запись в журнал.
    console.error(
      "[send-comment-private-reply] delivered message was not pending anymore; provider id not recorded",
      { privateReplyId: input.privateReplyId },
    );
  }
}

/** Помечает ЛС `failed` — вызывается из onFailure и компенсацией в действии. */
export async function markPrivateReplyFailed(input: {
  workspaceId: string;
  privateReplyId: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("comment_private_replies")
    .update({ status: "failed" })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.privateReplyId)
    .eq("status", "pending");
  assertQuerySucceeded(error, "Marking the private reply failed");
}

/**
 * Единственный внешний вызов прогона. Провайдер без private reply и 4xx
 * (кроме 408/429) — окончательные отказы: `FatalError` отменяет ретраи, а
 * компенсация в теле прогона пометит строку `failed`.
 */
export async function sendPrivateReplyViaAdapter(
  context: LoadedPrivateReplyContext,
): Promise<string> {
  "use step";

  try {
    return await deliverThroughProvider(context);
  } catch (error) {
    if (FatalError.is(error)) throw error;
    rethrowAsWorkflowSendError(error);
  }
}
sendPrivateReplyViaAdapter.maxRetries = 4;

/** Шаг-обёртка над компенсацией: откат такой же durable, как и работа. */
export async function markPrivateReplyFailedStep(input: {
  workspaceId: string;
  privateReplyId: string;
}): Promise<void> {
  "use step";

  await markPrivateReplyFailed(input);
}

loadPrivateReplyContext.maxRetries = 4;
markPrivateReplySent.maxRetries = 4;
