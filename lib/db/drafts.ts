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
  kb_file_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

type KbFileRow = { id: string; name: string };

export type DraftMutationResult =
  | { ok: true; draft: ActiveDraftView }
  | { ok: false; error: string };

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

  const kbFileIds = row.kb_file_ids ?? [];
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Latest generating/ready/edited draft; terminal drafts never reach the panel. */
export async function getActiveConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ActiveDraftView | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select(
      "id, workspace_id, conversation_id, status, text, model, kb_file_ids, created_at, updated_at",
    )
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

export async function editConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  draftId: string,
  text: string,
): Promise<DraftMutationResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return { ok: false, error: "Текст черновика не может быть пустым." };
  }

  const { data, error } = await supabase
    .from("drafts")
    .update({
      text: normalizedText,
      status: "edited",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", draftId)
    .in("status", ["ready", "edited"])
    .select(
      "id, workspace_id, conversation_id, status, text, model, kb_file_ids, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    console.error("[drafts] failed to edit conversation draft", error);
    return { ok: false, error: "Не удалось сохранить черновик." };
  }

  if (!data) {
    return { ok: false, error: "Черновик уже изменился — обновите тред." };
  }

  return { ok: true, draft: await mapDraftRow(supabase, data as DraftRow) };
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

/** RLS-scoped ownership check before emitting an asynchronous regeneration. */
export async function canRegenerateConversationDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .eq("kind", "dm")
    .maybeSingle();

  if (error) {
    console.error("[drafts] failed to validate regeneration conversation", error);
    return false;
  }

  return Boolean(data);
}
