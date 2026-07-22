import "server-only";

import { NonRetriableError } from "inngest";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

// Side-effect import: registers the Zernio adapter so
// `resolveChannelAdapter("zernio")` works in the Inngest route's module
// graph, same as the webhook route does before resolving.
import "@/lib/channels/zernio";

export type SendMessagePipelineInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};

export type SendMessagePipelineResult =
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

export type SendMessageSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

/**
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
  | { status: "skip"; reason: Extract<SendMessagePipelineResult, { status: "skipped" }>["reason"] };

export type SendMessageDependencies = {
  loadContext(input: SendMessagePipelineInput): Promise<LoadSendContextResult>;
  /** Sends through the channel adapter; returns the provider's message ID. */
  sendViaAdapter(context: LoadedSendContext): Promise<string>;
  markSent(input: {
    workspaceId: string;
    messageId: string;
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
  input: SendMessagePipelineInput,
): Promise<LoadSendContextResult> {
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

async function sendViaAdapter(context: LoadedSendContext): Promise<string> {
  const adapter = resolveChannelAdapter(context.provider);
  const result = await adapter.sendMessage({
    channelConnectionId: context.channelConnectionId,
    externalAccountId: context.externalAccountId,
    conversationExternalId: context.conversationExternalId,
    text: context.text,
  });

  return result.providerMessageId;
}

async function markSent(input: {
  workspaceId: string;
  messageId: string;
  providerMessageId: string;
}): Promise<void> {
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
 * Marks the outgoing message `failed` — used by the function's onFailure
 * (retries exhausted) and by server actions when even emitting the event
 * failed. The `pending` guard never demotes a message that already made it
 * to `sent`.
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

export const sendMessageDependencies: SendMessageDependencies = {
  loadContext,
  sendViaAdapter,
  markSent,
};

/**
 * True for provider errors that will not succeed on retry: any HTTP 4xx
 * except 408 (timeout) and 429 (rate limit) — an expired WhatsApp
 * 24-hour window, a platform limitation, a malformed conversation ID.
 * Duck-types on a numeric `status` (ZernioApiError carries one) instead of
 * importing a provider error class — vibecoding rule 4 keeps provider types
 * inside `lib/channels/`.
 */
export function isNonRetriableSendError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;

  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * The send-message pipeline (docs/architecture/07-data-flows.md#63-отправка-ответа):
 * load-context (with idempotency guards) → send-via-adapter → mark-sent.
 *
 * `step.run` memoizes the adapter call, so a retry of a later step never
 * re-sends. Known at-least-once window: a crash after the provider accepted
 * the send but before the step result is persisted would re-send on retry —
 * Zernio's send endpoint has no idempotency key to close it.
 */
export async function runSendMessagePipeline(
  input: SendMessagePipelineInput,
  steps: SendMessageSteps,
  dependencies: SendMessageDependencies = sendMessageDependencies,
): Promise<SendMessagePipelineResult> {
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
          error instanceof Error ? error.message : "Provider rejected the send.",
          { cause: error },
        );
      }
      throw error;
    }
  });

  await steps.run("mark-sent", () =>
    dependencies.markSent({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      providerMessageId,
    }),
  );

  return { status: "sent", providerMessageId };
}
