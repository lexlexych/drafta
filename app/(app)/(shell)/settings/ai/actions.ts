"use server";

import { revalidatePath } from "next/cache";

import { getAiModelOptions } from "@/lib/ai/config";
import type { AiSettingsInput } from "@/lib/ai/settings";
import { saveWorkspaceAiSettings } from "@/lib/db/ai-settings";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

const SETTINGS_PATH = "/settings";

export async function saveAiSettingsAction(input: AiSettingsInput) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false as const, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false as const, error: "Рабочее пространство не найдено." };
  }

  const modelOptions = getAiModelOptions();
  const supabase = await createServerSupabaseClient();
  const result = await saveWorkspaceAiSettings(
    supabase,
    workspace.id,
    input,
    modelOptions.map((option) => option.value),
  );

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}
