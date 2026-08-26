import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Outgoing-send data helpers (stage 3,
 * docs/architecture/07-data-flows.md#63-отправка-ответа). All writes go
 * through the caller's RLS-scoped client — the `accept_reply_for_send` RPC
 * is `security invoker`, so workspace membership policies keep applying.
 */

export type OutgoingSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

async function callAcceptReplyForSend(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    conversationId: string;
    replyText: string | null;
    draftId: string | null;
  },
  conflictError: string,
): Promise<OutgoingSendResult> {
  const { data, error } = await supabase.rpc("accept_reply_for_send", {
    target_workspace_id: input.workspaceId,
    target_conversation_id: input.conversationId,
    reply_text: input.replyText,
    target_draft_id: input.draftId,
  });

  if (error) {
    console.error("[outgoing] accept_reply_for_send failed", error);
    return { ok: false, error: "Не удалось подготовить отправку." };
  }

  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, error: conflictError };
  }

  return { ok: true, messageId: data };
}

/**
 * Composer send — the only send path there is, whether the text was typed from
 * scratch or generated and then edited in place.
 *
 * `draftId` is the draft the field's text came from, when it came from one: the
 * RPC then marks that draft `sent` in the same transaction instead of letting
 * it be superseded, so «оператор воспользовался черновиком» stays visible in
 * the data. The text still comes from the composer, edits included. Any other
 * active draft is superseded either way — a reply answers the batch they all
 * targeted.
 */
export async function createManualOutgoingMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  text: string,
  draftId: string | null = null,
): Promise<OutgoingSendResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return { ok: false, error: "Текст сообщения не может быть пустым." };
  }

  return callAcceptReplyForSend(
    supabase,
    { workspaceId, conversationId, replyText: normalizedText, draftId },
    "Диалог не найден.",
  );
}

/**
 * The "Повторить" path: a `failed` outgoing message goes back to `pending`
 * so a fresh `message/send` event can pick it up. The conditional update is
 * atomic on its own — no RPC needed.
 */
export async function retryFailedOutgoingMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): Promise<OutgoingSendResult> {
  const { data, error } = await supabase
    .from("messages")
    .update({ delivery_status: "pending", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", messageId)
    .eq("direction", "outgoing")
    .eq("delivery_status", "failed")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[outgoing] failed to reset a failed message", error);
    return { ok: false, error: "Не удалось повторить отправку." };
  }

  if (!data) {
    return { ok: false, error: "Сообщение уже изменилось — обновите тред." };
  }

  return { ok: true, messageId };
}

/**
 * Compensation when emitting `message/send` throws after the message was
 * persisted `pending`: without the event nothing will ever send it, so it
 * becomes `failed` and the thread shows the retry button.
 */
export async function markOutgoingMessageFailedAfterEmit(
  supabase: SupabaseClient,
  workspaceId: string,
  messageId: string,
): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ delivery_status: "failed", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", messageId)
    .eq("delivery_status", "pending");

  if (error) {
    // Best-effort: the message stays pending and never sends; the user sees
    // a stuck "Отправляется…" instead of the retry button, but nothing is
    // sent twice. Logged for operators.
    console.error("[outgoing] failed to mark unsent message as failed", error);
  }
}
