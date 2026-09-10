import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TRANSLATION_MAX_SOURCE_LENGTH } from "./budget";
import { translateText } from "./translate-text";

export async function translateDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  draftId: string,
  text: string,
  targetLanguage: string,
) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false as const, error: "В черновике нет текста для перевода." };
  }
  if (text.length > TRANSLATION_MAX_SOURCE_LENGTH) {
    return { ok: false as const, error: "Черновик слишком длинный для перевода." };
  }

  const { data, error } = await supabase
    .from("drafts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", draftId)
    .in("status", ["ready", "edited"])
    .is("manual_review_reason", null)
    .maybeSingle();

  if (error || !data) {
    return { ok: false as const, error: "Черновик уже изменился — обновите тред." };
  }

  // Translate the current editor contents, including the operator's edits.
  const result = await translateText(workspaceId, text.trim(), targetLanguage, "message");
  if (!result.ok) return result;
  return { ok: true as const, text: result.text, sourceLanguage: result.sourceLanguage };
}
