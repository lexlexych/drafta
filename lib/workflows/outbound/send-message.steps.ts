import "server-only";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { rethrowAsWorkflowSendError } from "@/lib/workflows/send-errors";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in this step's module graph, same as
// the webhook route does before resolving.
import "@/lib/channels/zernio";

export type SendMessageInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};

export type SendMessageResult =
  | { status: "sent"; providerMessageId: string }
  | {
      status: "skipped";
      reason:
        | "message-not-found"
        | "not-outgoing"
        | "already-sent"
        | "not-pending"
        | "connection-inactive";
    };

/**
 * Direct messages only — publishing a comment reply is `./send-comment-pipeline.ts`.
 *
 * Everything the adapter call needs, loaded once by `load-context`. Carries
 * the outgoing text (loaded server-side from Postgres — the triggering event
 * itself is IDs-only per vibecoding rule 7).
 */
export type LoadedSendContext = {
  workspaceId: string;
  messageId: string;
  text: string;
  provider: string;
  channelConnectionId: string;
  /** channel_connections.external_id — the provider-side account ID. */
  externalAccountId: string;
  /** conversations.external_id — the provider-side conversation/thread ID. */
  conversationExternalId: string;
};

export type LoadSendContextResult =
  | { status: "ok"; context: LoadedSendContext }
  | { status: "skip"; reason: Extract<SendMessageResult, { status: "skipped" }>["reason"] };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

export async function loadSendContext(
  input: SendMessageInput,
): Promise<LoadSendContextResult> {
  "use step";

  const supabase = createAdminSupabaseClient();

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id, direction, external_id, delivery_status, text")
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .eq("id", input.messageId)
    .maybeSingle();
  assertQuerySucceeded(messageError, "Loading the outgoing message");

  // The guards below are the pipeline's idempotency: a redelivered event or
  // a retried run for a message that already went out (external_id set, or
  // status moved past pending) must become a no-op, never a second send.
  if (!message) {
    return { status: "skip", reason: "message-not-found" };
  }
  if (message.direction !== "outgoing") {
    return { status: "skip", reason: "not-outgoing" };
  }
  if (message.external_id !== null) {
    return { status: "skip", reason: "already-sent" };
  }
  if (message.delivery_status !== "pending") {
    return { status: "skip", reason: "not-pending" };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("external_id, channel_connection_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();
  assertQuerySucceeded(conversationError, "Loading the send conversation");

  if (!conversation) {
    throw new Error("The outgoing message's conversation is unavailable.");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("id, provider, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", conversation.channel_connection_id)
    .maybeSingle();
  assertQuerySucceeded(connectionError, "Loading the channel connection");

  if (!connection) {
    throw new Error("The conversation's channel connection is unavailable.");
  }
  if (connection.status !== "active") {
    return { status: "skip", reason: "connection-inactive" };
  }

  return {
    status: "ok",
    context: {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      text: message.text,
      provider: connection.provider,
      channelConnectionId: connection.id,
      externalAccountId: connection.external_id,
      conversationExternalId: conversation.external_id,
    },
  };
}

/**
 * Единственный внешний вызов прогона. 4xx (кроме 408/429) превращается в
 * `FatalError` — повторять такое бессмысленно, и компенсация в теле прогона
 * пометит сообщение `failed`.
 */
export async function sendMessageViaAdapter(
  context: LoadedSendContext,
): Promise<string> {
  "use step";

  try {
    return await sendThroughProvider(context);
  } catch (error) {
    rethrowAsWorkflowSendError(error);
  }
}
sendMessageViaAdapter.maxRetries = 4;

async function sendThroughProvider(context: LoadedSendContext): Promise<string> {
  const adapter = resolveChannelAdapter(context.provider);
  const result = await adapter.sendMessage({
    channelConnectionId: context.channelConnectionId,
    externalAccountId: context.externalAccountId,
    conversationExternalId: context.conversationExternalId,
    text: context.text,
    interactionKind: "dm",
  });

  return result.providerMessageId;
}

export async function markMessageSent(input: {
  workspaceId: string;
  messageId: string;
  providerMessageId: string;
}): Promise<void> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("messages")
    .update({
      external_id: input.providerMessageId,
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.messageId)
    .eq("delivery_status", "pending")
    .select("id")
    .maybeSingle();
  assertQuerySucceeded(error, "Marking the outgoing message sent");

  if (!data) {
    // The pending guard did not match — some concurrent transition happened.
    // The provider send already succeeded, so this stays a log, not a retry
    // (a retry could not undo the send anyway).
    console.error(
      "[send-message] sent message row was not pending anymore; provider id not recorded",
      { messageId: input.messageId },
    );
  }
}

/**
 * Помечает исходящее `failed`. Вызывается компенсацией в теле прогона (ретраи
 * исчерпаны — бывший `onFailure`) и серверными действиями, когда не удалось
 * даже запустить прогон. Условие `pending` не даёт понизить сообщение, которое
 * уже успело стать `sent`.
 *
 * Отдельная функция без директивы: её зовут и из прогона (через шаг-обёртку
 * `markMessageSendFailedStep`), и из обычного запроса, где workflow-контекста
 * нет вовсе.
 */
export async function markMessageSendFailed(input: {
  workspaceId: string;
  messageId: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("messages")
    .update({ delivery_status: "failed", updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.messageId)
    .eq("delivery_status", "pending");
  assertQuerySucceeded(error, "Marking the outgoing message failed");
}

/** Шаг-обёртка над компенсацией: делает откат таким же durable, как и работу. */
export async function markMessageSendFailedStep(input: {
  workspaceId: string;
  messageId: string;
}): Promise<void> {
  "use step";

  await markMessageSendFailed(input);
}

loadSendContext.maxRetries = 4;
markMessageSent.maxRetries = 4;
