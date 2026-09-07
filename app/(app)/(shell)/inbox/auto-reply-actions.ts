"use server";

import { revalidatePath } from "next/cache";

import {
  createAutoReplyScenario,
  deleteAutoReplyScenario,
  moveAutoReplyScenario,
  saveAutoReplySettings,
  updateAutoReplyScenario,
  type AutoReplyResult,
  type AutoReplyScenarioRow,
} from "@/lib/db/auto-reply";
import type {
  AutoReplySettingsInput,
  ScenarioInput,
} from "@/lib/auto-reply/validation";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

/**
 * Настройки автоответов из панели «Сообщений»
 * (docs/architecture/10-ui.md#панель-автоответов).
 *
 * `workspace_id` берётся только из сессии — клиент его не передаёт ни в одном
 * из экшенов, как и во всём остальном приложении.
 */

const INBOX_PATH = "/inbox";

async function requireWorkspaceId(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  return { ok: true, workspaceId: workspace.id };
}

export async function saveAutoReplySettingsAction(
  input: AutoReplySettingsInput,
): Promise<AutoReplyResult<AutoReplySettingsInput>> {
  const workspace = await requireWorkspaceId();

  if (!workspace.ok) {
    return { ok: false, error: workspace.error };
  }

  const supabase = await createServerSupabaseClient();
  const result = await saveAutoReplySettings(
    supabase,
    workspace.workspaceId,
    input,
  );

  if (result.ok) {
    // Значок в шапке списка показывает «вкл»/«выкл» — он приезжает со страницы.
    revalidatePath(INBOX_PATH);
  }

  return result;
}

export async function createAutoReplyScenarioAction(
  input: ScenarioInput,
): Promise<AutoReplyResult<AutoReplyScenarioRow>> {
  const workspace = await requireWorkspaceId();

  if (!workspace.ok) {
    return { ok: false, error: workspace.error };
  }

  const supabase = await createServerSupabaseClient();
  const result = await createAutoReplyScenario(
    supabase,
    workspace.workspaceId,
    input,
  );

  if (result.ok) {
    revalidatePath(INBOX_PATH);
  }

  return result;
}

export async function updateAutoReplyScenarioAction(
  input: ScenarioInput & { id: string },
): Promise<AutoReplyResult<AutoReplyScenarioRow>> {
  const workspace = await requireWorkspaceId();

  if (!workspace.ok) {
    return { ok: false, error: workspace.error };
  }

  const { id, ...scenario } = input;
  const supabase = await createServerSupabaseClient();
  const result = await updateAutoReplyScenario(
    supabase,
    workspace.workspaceId,
    id,
    scenario,
  );

  if (result.ok) {
    revalidatePath(INBOX_PATH);
  }

  return result;
}

export async function deleteAutoReplyScenarioAction(
  scenarioId: string,
): Promise<AutoReplyResult<{ id: string }>> {
  const workspace = await requireWorkspaceId();

  if (!workspace.ok) {
    return { ok: false, error: workspace.error };
  }

  const supabase = await createServerSupabaseClient();
  const result = await deleteAutoReplyScenario(
    supabase,
    workspace.workspaceId,
    scenarioId,
  );

  if (result.ok) {
    revalidatePath(INBOX_PATH);
  }

  return result;
}

export async function moveAutoReplyScenarioAction(
  scenarioId: string,
  direction: "up" | "down",
): Promise<AutoReplyResult<{ id: string }>> {
  const workspace = await requireWorkspaceId();

  if (!workspace.ok) {
    return { ok: false, error: workspace.error };
  }

  const supabase = await createServerSupabaseClient();
  const result = await moveAutoReplyScenario(
    supabase,
    workspace.workspaceId,
    scenarioId,
    direction,
  );

  if (result.ok) {
    revalidatePath(INBOX_PATH);
  }

  return result;
}
