"use server";

import { revalidatePath } from "next/cache";

import {
  createReplyTemplate,
  deleteReplyTemplate,
  updateReplyTemplate,
  type ReplyTemplateInput,
  type ReplyTemplateResult,
  type ReplyTemplateRow,
} from "@/lib/db/reply-templates";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

const SETTINGS_PATH = "/settings";

async function requireCurrentWorkspaceId(): Promise<
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

/**
 * Шаблоны видны не только в настройках, но и поповером в треде, поэтому
 * обновляем обе поверхности.
 */
function refreshTemplates() {
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/inbox");
}

export async function createReplyTemplateAction(
  input: ReplyTemplateInput,
): Promise<ReplyTemplateResult<ReplyTemplateRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await createReplyTemplate(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshTemplates();
  }

  return result;
}

export async function updateReplyTemplateAction(
  input: ReplyTemplateInput & { id: string },
): Promise<ReplyTemplateResult<ReplyTemplateRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await updateReplyTemplate(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshTemplates();
  }

  return result;
}

export async function deleteReplyTemplateAction(input: {
  id: string;
}): Promise<ReplyTemplateResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await deleteReplyTemplate(
    supabase,
    workspace.workspaceId,
    input.id,
  );

  if (result.ok) {
    refreshTemplates();
  }

  return result;
}
