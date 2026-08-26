import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_WORKSPACE_LANGUAGE,
  resolveWorkspaceLanguage,
  type WorkspaceLanguage,
} from "@/lib/i18n/languages";

/**
 * Язык интерфейса workspace в `workspaces.settings.lang`.
 *
 * Клиент — пользовательский (RLS): читать может любой участник, а менять,
 * по политике `workspaces_update_owner`, только владелец. `settings`
 * дописывается слиянием, чтобы не затереть соседние ключи
 * (например `providerProfiles`, см. `channel-provider-profile.ts`).
 */

type WorkspaceSettings = Record<string, unknown>;

async function readSettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  if (error) {
    console.error("[workspace] failed to read settings", error);
    throw new Error("Unable to read workspace settings.");
  }

  return (data?.settings ?? {}) as WorkspaceSettings;
}

export async function getWorkspaceLanguage(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceLanguage> {
  try {
    return resolveWorkspaceLanguage(await readSettings(supabase, workspaceId));
  } catch {
    return DEFAULT_WORKSPACE_LANGUAGE;
  }
}

export async function setWorkspaceLanguage(
  supabase: SupabaseClient,
  workspaceId: string,
  language: WorkspaceLanguage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let settings: WorkspaceSettings;

  try {
    settings = await readSettings(supabase, workspaceId);
  } catch {
    return { ok: false, error: "Не удалось прочитать настройки рабочего пространства." };
  }

  const { data, error } = await supabase
    .from("workspaces")
    .update({ settings: { ...settings, lang: language } })
    .eq("id", workspaceId)
    .select("id");

  if (error) {
    console.error("[workspace] failed to persist language", error);
    return { ok: false, error: "Не удалось сохранить язык." };
  }

  // RLS отдаёт пустой результат, когда апдейт не прошёл политику владельца.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Менять язык может только владелец рабочего пространства.",
    };
  }

  return { ok: true };
}
