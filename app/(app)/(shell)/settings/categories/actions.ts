"use server";

import { revalidatePath } from "next/cache";

import {
  createCategory,
  deleteCategory,
  reorderCategories,
  updateCategory,
  type CategoryInput,
  type CategoryResult,
} from "@/lib/db/categories";
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

function refreshCategoriesSection() {
  revalidatePath(SETTINGS_PATH);
}

export async function createCategoryAction(
  input: CategoryInput,
): Promise<CategoryResult<string>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await createCategory(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshCategoriesSection();
  }

  return result;
}

export async function updateCategoryAction(
  input: CategoryInput & { id: string; isDefault: boolean },
): Promise<CategoryResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await updateCategory(supabase, workspace.workspaceId, input);

  if (result.ok) {
    refreshCategoriesSection();
  }

  return result;
}

export async function deleteCategoryAction(input: {
  id: string;
}): Promise<CategoryResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await deleteCategory(
    supabase,
    workspace.workspaceId,
    input.id,
  );

  if (result.ok) {
    refreshCategoriesSection();
  }

  return result;
}

export async function reorderCategoriesAction(input: {
  ids: string[];
}): Promise<CategoryResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await reorderCategories(
    supabase,
    workspace.workspaceId,
    input.ids,
  );

  if (result.ok) {
    refreshCategoriesSection();
  }

  return result;
}
