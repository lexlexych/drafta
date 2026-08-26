import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActiveDraftStatus, ActiveDraftView } from "@/lib/drafts/types";

const ACTIVE_DRAFT_STATUSES: ActiveDraftStatus[] = [
  "generating",
  "ready",
  "edited",
];

type DraftRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  status: string;
  text: string;
  model: string | null;
  matched_kb_file_ids: string[] | null;
  manual_review_reason: string | null;
  created_at: string;
  updated_at: string;
};

const DRAFT_COLUMNS =
  "id, workspace_id, conversation_id, status, text, model, matched_kb_file_ids, manual_review_reason, created_at, updated_at";

type KbFileRow = { id: string; name: string };

function isActiveDraftStatus(status: string): status is ActiveDraftStatus {
  return ACTIVE_DRAFT_STATUSES.includes(status as ActiveDraftStatus);
}

async function mapDraftRow(
  supabase: SupabaseClient,
  row: DraftRow,
): Promise<ActiveDraftView> {
  if (!isActiveDraftStatus(row.status)) {
    throw new Error(`Cannot map inactive draft status: ${row.status}`);
  }

  // Строка-заметка над полем ввода показывает не всё, что ушло в промпт, а
  // категории, в которых модель нашла ответ, — это и есть «источник» черновика
  // для оператора.
  const kbFileIds = row.matched_kb_file_ids ?? [];
  let kbFileNames: string[] = [];

  if (kbFileIds.length > 0) {
    const { data, error } = await supabase
      .from("kb_files")
      .select("id, name")
      .eq("workspace_id", row.workspace_id)
      .in("id", kbFileIds);

    if (error) {
      console.error("[drafts] failed to load knowledge-base file names", error);
      throw new Error("Unable to load draft knowledge-base references.");
    }

    const namesById = new Map(
      ((data ?? []) as KbFileRow[]).map((file) => [file.id, file.name]),
    );
    kbFileNames = kbFileIds.flatMap((id) => {
      const name = namesById.get(id);
      return name ? [name] : [];
    });
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    status: row.status,
    text: row.text,
    model: row.model,
    kbFileIds,
    kbFileNames,
    manualReviewReason: row.manual_review_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Latest generating/ready/edited draft; terminal drafts never reach the thread.
 *
 * This is what puts a draft the operator never sent back into the composer
 * after a reload or a trip to another conversation — the composer's own state
 * is client-side and does not survive either.
 */
export async function getActiveConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ActiveDraftView | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select(DRAFT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .in("status", ACTIVE_DRAFT_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[drafts] failed to load active conversation draft", error);
    throw new Error("Unable to load the active draft.");
  }

  return data ? mapDraftRow(supabase, data as DraftRow) : null;
}

export async function discardConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  draftId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("drafts")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", draftId)
    .in("status", ["ready", "edited"])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[drafts] failed to discard conversation draft", error);
    return { ok: false, error: "Не удалось отклонить черновик." };
  }

  return data
    ? { ok: true }
    : { ok: false, error: "Черновик уже изменился — обновите тред." };
}

/**
 * «Стоп» during generation: whatever this conversation is currently generating
 * stops being the operator's problem.
 *
 * Deliberately not keyed by draft id — the composer knows a run is in flight
 * before it ever sees the row (it locks optimistically on click), so the id may
 * not be on the client yet. Being an UPDATE, it also reaches every other open
 * tab through the `drafts` realtime subscription, which a DELETE could not.
 */
export async function discardGeneratingConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("drafts")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("status", "generating");

  if (error) {
    console.error("[drafts] failed to discard a generating draft", error);
    return { ok: false, error: "Не удалось остановить генерацию." };
  }

  return { ok: true };
}

/**
 * RLS-scoped precondition for asking the pipeline to generate: the conversation
 * has to be ours, and it has to contain something to answer.
 *
 * The incoming-message check is here rather than only in the pipeline because
 * the composer locks its field the moment the icon is pressed — a run that
 * would end in `skipped` has to be refused loudly, before the event is emitted.
 */
export async function canGenerateConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: conversation, error: conversationError }, { data: incoming, error: incomingError }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", conversationId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId)
        .eq("direction", "incoming")
        .limit(1)
        .maybeSingle(),
    ]);

  if (conversationError || incomingError) {
    console.error(
      "[drafts] failed to validate a generation request",
      conversationError ?? incomingError,
    );
    return { ok: false, error: "Не удалось запустить генерацию." };
  }

  if (!conversation) {
    return { ok: false, error: "Диалог не найден." };
  }

  if (!incoming) {
    return { ok: false, error: "Нет входящих сообщений для ответа." };
  }

  return { ok: true };
}
