"use server";

import { revalidatePath } from "next/cache";

import { setWorkspaceLanguage } from "@/lib/db/workspace-language";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import { isWorkspaceLanguage } from "@/lib/i18n/languages";

const SETTINGS_PATH = "/settings";

export type SaveWorkspaceLanguageResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Сохраняет язык интерфейса в `workspaces.settings.lang`. Сам интерфейс на
 * него пока не переключается — это только сохранённое предпочтение.
 */
export async function saveWorkspaceLanguageAction(
  language: string,
): Promise<SaveWorkspaceLanguageResult> {
  if (!isWorkspaceLanguage(language)) {
    return { ok: false, error: "Неизвестный язык." };
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  const supabase = await createServerSupabaseClient();
  const result = await setWorkspaceLanguage(supabase, workspace.id, language);

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}
