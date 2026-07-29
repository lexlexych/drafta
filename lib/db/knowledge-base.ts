import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateCategory } from "@/lib/knowledge-base/files";
import type { CategoryBadgeView } from "@/lib/mock";

/**
 * A row of `kb_files` is a **category** of the workspace knowledge base: `name`
 * is the category title the AI returns in its `CATEGORIES:` line, `content` is
 * the markdown that both describes the category and serves as the knowledge
 * about it (docs/architecture/09-categories.md).
 */
export type KnowledgeFileRow = {
  id: string;
  workspace_id: string;
  name: string;
  content: string;
  sort_order: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type KnowledgeFileResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const COLUMNS =
  "id, workspace_id, name, content, sort_order, is_enabled, created_at, updated_at";

export async function listKnowledgeFiles(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KnowledgeFileRow[]> {
  const { data, error } = await supabase
    .from("kb_files")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[settings/knowledge] failed to list kb_files", error);
    throw new Error("Unable to load knowledge base categories.");
  }

  return (data ?? []) as KnowledgeFileRow[];
}

/**
 * Palette shared by the dialog-list chips, the list filter and the dashboard
 * chart: the colour follows the category's own position in the workspace list,
 * so the same category is the same colour everywhere on screen. There is no
 * fixed number of categories any more, so the palette cycles instead of turning
 * everything past the fifth one grey.
 */
const CATEGORY_COLOR_VARS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5"];

/** Badge view models for the dialog list chip, the list filter and the chart. */
export function categoryBadges(
  categories: readonly KnowledgeFileRow[],
): CategoryBadgeView[] {
  return categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    colorVar: CATEGORY_COLOR_VARS[index % CATEGORY_COLOR_VARS.length]!,
  }));
}

async function hasNameConflict(
  supabase: SupabaseClient,
  workspaceId: string,
  name: string,
  excludedId?: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("kb_files")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[settings/knowledge] failed to validate kb_file name", error);
    throw new Error("Unable to validate the category name.");
  }

  const normalized = name.toLocaleLowerCase("ru-RU");

  return (data ?? []).some(
    (file) =>
      file.id !== excludedId &&
      String(file.name).toLocaleLowerCase("ru-RU") === normalized,
  );
}

export async function createKnowledgeFile(
  supabase: SupabaseClient,
  workspaceId: string,
  input: { name: string; content: string },
): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const validation = validateCategory(input.name, input.content);

  if (!validation.ok) {
    return validation;
  }
  if (await hasNameConflict(supabase, workspaceId, validation.name)) {
    return { ok: false, error: "Категория с таким названием уже существует." };
  }

  const { data: lastFile, error: orderError } = await supabase
    .from("kb_files")
    .select("sort_order")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    console.error("[settings/knowledge] failed to resolve kb_file order", orderError);
    return { ok: false, error: "Не удалось добавить категорию." };
  }

  const { data, error } = await supabase
    .from("kb_files")
    .insert({
      workspace_id: workspaceId,
      name: validation.name,
      content: validation.content,
      sort_order: (lastFile?.sort_order ?? -1) + 1,
      is_enabled: true,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[settings/knowledge] failed to create kb_file", error);
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Категория с таким названием уже существует."
          : "Не удалось добавить категорию.",
    };
  }

  return { ok: true, data: data as KnowledgeFileRow };
}

export async function updateKnowledgeFile(
  supabase: SupabaseClient,
  workspaceId: string,
  input: { id: string; name: string; content: string },
): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const validation = validateCategory(input.name, input.content);

  if (!validation.ok) {
    return validation;
  }
  if (
    await hasNameConflict(supabase, workspaceId, validation.name, input.id)
  ) {
    return { ok: false, error: "Категория с таким названием уже существует." };
  }

  const { data, error } = await supabase
    .from("kb_files")
    .update({
      name: validation.name,
      content: validation.content,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", input.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[settings/knowledge] failed to update kb_file", error);
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Категория с таким названием уже существует."
          : "Не удалось сохранить категорию.",
    };
  }
  if (!data) {
    return { ok: false, error: "Категория не найдена." };
  }

  return { ok: true, data: data as KnowledgeFileRow };
}

export async function setKnowledgeFileEnabled(
  supabase: SupabaseClient,
  workspaceId: string,
  input: { id: string; isEnabled: boolean },
): Promise<KnowledgeFileResult<KnowledgeFileRow>> {
  const { data, error } = await supabase
    .from("kb_files")
    .update({
      is_enabled: input.isEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", input.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[settings/knowledge] failed to toggle kb_file", error);
    return { ok: false, error: "Не удалось изменить статус категории." };
  }
  if (!data) {
    return { ok: false, error: "Категория не найдена." };
  }

  return { ok: true, data: data as KnowledgeFileRow };
}

export async function deleteKnowledgeFile(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<KnowledgeFileResult<null>> {
  const { data, error } = await supabase
    .from("kb_files")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[settings/knowledge] failed to delete kb_file", error);
    return { ok: false, error: "Не удалось удалить категорию." };
  }
  if (!data) {
    return { ok: false, error: "Категория не найдена." };
  }

  return { ok: true, data: null };
}
