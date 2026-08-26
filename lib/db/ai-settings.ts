import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateAiSettingsInput,
  type AiSettingsInput,
} from "@/lib/ai/settings";

export type AiSettingsRow = {
  id: string;
  workspace_id: string;
  system_prompt: string;
  comment_system_prompt: string;
  model: string;
  created_at: string;
  updated_at: string;
};

export type AiSettingsResult =
  | { ok: true; data: AiSettingsRow }
  | { ok: false; error: string };

const AI_SETTINGS_COLUMNS =
  "id, workspace_id, system_prompt, comment_system_prompt, model, created_at, updated_at";

export async function getWorkspaceAiSettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AiSettingsRow> {
  const { data, error } = await supabase
    .from("ai_settings")
    .select(AI_SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("[settings/ai] failed to load ai_settings", error);
    throw new Error("Unable to load AI settings.");
  }
  if (!data) {
    throw new Error("Workspace AI settings are unavailable.");
  }

  return data as AiSettingsRow;
}

export async function saveWorkspaceAiSettings(
  supabase: SupabaseClient,
  workspaceId: string,
  input: AiSettingsInput,
  allowedModels: readonly string[],
): Promise<AiSettingsResult> {
  const validation = validateAiSettingsInput(input, allowedModels);

  if (!validation.ok) {
    return validation;
  }

  const { data, error } = await supabase
    .from("ai_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        system_prompt: validation.data.systemPrompt,
        comment_system_prompt: validation.data.commentSystemPrompt,
        model: validation.data.model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    )
    .select(AI_SETTINGS_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[settings/ai] failed to save ai_settings", error);
    return {
      ok: false,
      error:
        error?.code === "42501"
          ? "Нет доступа к этому рабочему пространству."
          : "Не удалось сохранить AI-настройки.",
    };
  }

  return { ok: true, data: data as AiSettingsRow };
}
