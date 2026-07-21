import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoryIncomingKind = "dm" | "comments" | "both";

export type CategoryRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  draft_instruction: string | null;
  channel_connection_ids: string[];
  incoming_kind: CategoryIncomingKind;
  skip_draft: boolean;
  priority: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type CategoryInput = {
  name: string;
  description: string;
  draftInstruction: string;
  channelConnectionIds: string[];
  incomingKind: CategoryIncomingKind;
  skipDraft: boolean;
};

export type CategoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CATEGORY_COLUMNS =
  "id, workspace_id, name, description, draft_instruction, channel_connection_ids, incoming_kind, skip_draft, priority, is_default, created_at, updated_at";

const INCOMING_KINDS: CategoryIncomingKind[] = ["dm", "comments", "both"];

export async function listCategories(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("priority", { ascending: true });

  if (error) {
    console.error("[settings/categories] failed to list categories", error);
    throw new Error("Unable to load categories.");
  }

  return (data ?? []) as CategoryRow[];
}

function normalizeCategoryInput(
  input: CategoryInput,
  options: { isDefault?: boolean } = {},
): CategoryResult<CategoryInput> {
  const normalized: CategoryInput = {
    name: input.name.trim(),
    description: input.description.trim(),
    draftInstruction: input.draftInstruction.trim(),
    channelConnectionIds: [...new Set(input.channelConnectionIds)],
    incomingKind: input.incomingKind,
    skipDraft: input.skipDraft,
  };

  if (!options.isDefault && !normalized.name) {
    return { ok: false, error: "Введите название категории." };
  }
  if (!options.isDefault && !normalized.description) {
    return { ok: false, error: "Опишите правило классификации." };
  }
  if (!INCOMING_KINDS.includes(normalized.incomingKind)) {
    return { ok: false, error: "Выберите тип входящего." };
  }

  return { ok: true, data: normalized };
}

function categoryRpcError(
  operation: "create" | "update" | "delete" | "reorder",
  error: { code?: string; message?: string },
): string {
  if (error.code === "23503") {
    return "Один из выбранных каналов больше недоступен.";
  }
  if (error.code === "23514" && operation === "delete") {
    return "Категорию «По умолчанию» удалить нельзя.";
  }
  if (error.code === "42501") {
    return "Нет доступа к этому рабочему пространству.";
  }

  return {
    create: "Не удалось добавить категорию.",
    update: "Не удалось сохранить категорию.",
    delete: "Не удалось удалить категорию.",
    reorder: "Не удалось изменить порядок категорий.",
  }[operation];
}

export async function createCategory(
  supabase: SupabaseClient,
  workspaceId: string,
  input: CategoryInput,
): Promise<CategoryResult<string>> {
  const normalized = normalizeCategoryInput(input);

  if (!normalized.ok) {
    return normalized;
  }

  const { data, error } = await supabase.rpc("create_category", {
    target_workspace_id: workspaceId,
    category_name: normalized.data.name,
    category_description: normalized.data.description,
    category_draft_instruction: normalized.data.draftInstruction || null,
    category_channel_connection_ids: normalized.data.channelConnectionIds,
    category_incoming_kind: normalized.data.incomingKind,
    category_skip_draft: normalized.data.skipDraft,
  });

  if (error || typeof data !== "string") {
    console.error("[settings/categories] failed to create category", error);
    return {
      ok: false,
      error: categoryRpcError("create", error ?? {}),
    };
  }

  return { ok: true, data };
}

export async function updateCategory(
  supabase: SupabaseClient,
  workspaceId: string,
  input: CategoryInput & { id: string; isDefault: boolean },
): Promise<CategoryResult<null>> {
  const normalized = normalizeCategoryInput(input, {
    isDefault: input.isDefault,
  });

  if (!normalized.ok) {
    return normalized;
  }

  const { data, error } = await supabase.rpc("update_category", {
    target_workspace_id: workspaceId,
    target_category_id: input.id,
    category_name: normalized.data.name,
    category_description: normalized.data.description,
    category_draft_instruction: normalized.data.draftInstruction || null,
    category_channel_connection_ids: normalized.data.channelConnectionIds,
    category_incoming_kind: normalized.data.incomingKind,
    category_skip_draft: normalized.data.skipDraft,
  });

  if (error) {
    console.error("[settings/categories] failed to update category", error);
    return { ok: false, error: categoryRpcError("update", error) };
  }
  if (data !== true) {
    return { ok: false, error: "Категория не найдена." };
  }

  return { ok: true, data: null };
}

export async function deleteCategory(
  supabase: SupabaseClient,
  workspaceId: string,
  categoryId: string,
): Promise<CategoryResult<null>> {
  const { data, error } = await supabase.rpc("delete_category", {
    target_workspace_id: workspaceId,
    target_category_id: categoryId,
  });

  if (error) {
    console.error("[settings/categories] failed to delete category", error);
    return { ok: false, error: categoryRpcError("delete", error) };
  }
  if (data !== true) {
    return { ok: false, error: "Категория не найдена." };
  }

  return { ok: true, data: null };
}

export async function reorderCategories(
  supabase: SupabaseClient,
  workspaceId: string,
  categoryIds: string[],
): Promise<CategoryResult<null>> {
  if (new Set(categoryIds).size !== categoryIds.length) {
    return { ok: false, error: "Порядок категорий содержит повторы." };
  }

  const { data, error } = await supabase.rpc("reorder_categories", {
    target_workspace_id: workspaceId,
    ordered_category_ids: categoryIds,
  });

  if (error) {
    console.error("[settings/categories] failed to reorder categories", error);
    return { ok: false, error: categoryRpcError("reorder", error) };
  }
  if (data !== true) {
    return { ok: false, error: "Не удалось изменить порядок категорий." };
  }

  return { ok: true, data: null };
}
