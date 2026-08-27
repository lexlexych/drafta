import "server-only";

import { NonRetriableError } from "inngest";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in the Inngest route's module graph.
import "@/lib/channels/zernio";

import { isNonRetriableSendError } from "./send-pipeline";

/**
 * Отправка личного сообщения автору комментария — Meta private reply.
 *
 * Отличается от `./send-comment-pipeline.ts` не только эндпоинтом: сообщение
 * адресовано комментарию, а не треду, и именно поэтому доходит до человека, с
 * которым переписки ещё нет. Сам тред появится в drafta позже — вебхуками
 * `conversation.started` / `message.sent`, а не отсюда.
 *
 * Отказ платформы («окно 7 дней закрыто», «уже отвечали», «платформа не
 * поддерживает») приходит как 400 и превращается в `NonRetriableError`: это
 * окончательный ответ, ретраи его не изменят.
 */

export type SendCommentPrivateReplyPipelineInput = {
  workspaceId: string;
  postId: string;
  privateReplyId: string;
};

export type SendCommentPrivateReplyPipelineResult =
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

export type SendCommentPrivateReplySteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
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
        SendCommentPrivateReplyPipelineResult,
        { status: "skipped" }
      >["reason"];
    };

export type SendCommentPrivateReplyDependencies = {
  loadContext(
    input: SendCommentPrivateReplyPipelineInput,
  ): Promise<LoadPrivateReplyContextResult>;
  sendViaAdapter(context: LoadedPrivateReplyContext): Promise<string>;
  markSent(input: {
    workspaceId: string;
    privateReplyId: string;
    providerMessageId: string;
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
  input: SendCommentPrivateReplyPipelineInput,
): Promise<LoadPrivateReplyContextResult> {
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

async function sendViaAdapter(
  context: LoadedPrivateReplyContext,
): Promise<string> {
  const adapter = resolveChannelAdapter(context.provider);

  if (!adapter.sendCommentPrivateReply) {
    // Провайдер без private reply — окончательный отказ, а не сбой связи.
    throw new NonRetriableError(
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

async function markSent(input: {
  workspaceId: string;
  privateReplyId: string;
  providerMessageId: string;
}): Promise<void> {
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

export const sendCommentPrivateReplyDependencies: SendCommentPrivateReplyDependencies =
  {
    loadContext,
    sendViaAdapter,
    markSent,
  };

export async function runSendCommentPrivateReplyPipeline(
  input: SendCommentPrivateReplyPipelineInput,
  steps: SendCommentPrivateReplySteps,
  dependencies: SendCommentPrivateReplyDependencies = sendCommentPrivateReplyDependencies,
): Promise<SendCommentPrivateReplyPipelineResult> {
  const loaded = await steps.run("load-context", () =>
    dependencies.loadContext(input),
  );
  if (loaded.status === "skip") {
    return { status: "skipped", reason: loaded.reason };
  }

  const providerMessageId = await steps.run("send-via-adapter", async () => {
    try {
      return await dependencies.sendViaAdapter(loaded.context);
    } catch (error) {
      if (isNonRetriableSendError(error)) {
        throw new NonRetriableError(
          error instanceof Error
            ? error.message
            : "Provider rejected the private reply.",
          { cause: error },
        );
      }
      throw error;
    }
  });

  await steps.run("mark-sent", () =>
    dependencies.markSent({
      workspaceId: input.workspaceId,
      privateReplyId: input.privateReplyId,
      providerMessageId,
    }),
  );

  return { status: "sent", providerMessageId };
}
