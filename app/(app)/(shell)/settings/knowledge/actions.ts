"use server";

import { revalidatePath } from "next/cache";

import {
  createKnowledgeFile,
  deleteKnowledgeFile,
  setKnowledgeFileEnabled,
  updateKnowledgeFile,
  type KnowledgeFileResult,
  type KnowledgeFileRow,
} from "@/lib/db/knowledge-base";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

const SETTINGS_PATH = "/settings";

async function requireCurrentWorkspaceId(): Promise<
  | { ok: true; workspaceId: string }
  | { ok: false; error: string }
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

function refreshKnowledgeSection() {
  revalidatePath(SETTINGS_PATH);
}

export async function createKnowledgeFileAction(input: {
  name: string;
  content: string;
}): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await createKnowledgeFile(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshKnowledgeSection();
  }

  return result;
}

export async function updateKnowledgeFileAction(input: {
  id: string;
  name: string;
  content: string;
}): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await updateKnowledgeFile(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshKnowledgeSection();
  }

  return result;
}

export async function setKnowledgeFileEnabledAction(input: {
  id: string;
  isEnabled: boolean;
}): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await setKnowledgeFileEnabled(
    supabase,
    workspace.workspaceId,
    input,
  );

  if (result.ok) {
    refreshKnowledgeSection();
  }

  return result;
}

export async function deleteKnowledgeFileAction(input: {
  id: string;
}): Promise<KnowledgeFileResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await deleteKnowledgeFile(
    supabase,
    workspace.workspaceId,
    input.id,
  );

  if (result.ok) {
    refreshKnowledgeSection();
  }

  return result;
}
