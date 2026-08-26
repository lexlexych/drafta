import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateTemplate,
  type TemplateBodies,
} from "@/lib/templates/validation";

/**
 * Шаблон ответа: название + готовые тексты по языкам (`bodies`), которые
 * оператор подставляет в поле ответа вместо AI-генерации. Активность задаётся
 * отдельно для переписки и для комментариев — один и тот же текст годится не
 * для обеих поверхностей сразу.
 */
export type ReplyTemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  bodies: TemplateBodies;
  is_enabled_for_messages: boolean;
  is_enabled_for_comments: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ReplyTemplateResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Поверхность, на которой шаблон предлагается оператору. */
export type TemplateSurface = "message" | "comment";

const COLUMNS =
  "id, workspace_id, name, bodies, is_enabled_for_messages, is_enabled_for_comments, sort_order, created_at, updated_at";

const SURFACE_COLUMNS: Record<TemplateSurface, string> = {
  message: "is_enabled_for_messages",
  comment: "is_enabled_for_comments",
};

export async function listReplyTemplates(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ReplyTemplateRow[]> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[settings/templates] failed to list reply_templates", error);
    throw new Error("Unable to load reply templates.");
  }

  return (data ?? []) as ReplyTemplateRow[];
}

/** Шаблоны для поповера в поле ответа: только активные для этой поверхности. */
export async function listActiveReplyTemplates(
  supabase: SupabaseClient,
  workspaceId: string,
  surface: TemplateSurface,
): Promise<ReplyTemplateRow[]> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq(SURFACE_COLUMNS[surface], true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[templates] failed to list active reply_templates", error);
    // Поповер — вспомогательный инструмент: тред не должен падать из-за него.
    return [];
  }

  return (data ?? []) as ReplyTemplateRow[];
}

async function hasNameConflict(
  supabase: SupabaseClient,
  workspaceId: string,
  name: string,
  excludedId?: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("reply_templates")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[settings/templates] failed to validate template name", error);
    throw new Error("Unable to validate the template name.");
  }

  const normalized = name.toLocaleLowerCase("ru-RU");

  return (data ?? []).some(
    (template) =>
      template.id !== excludedId &&
      String(template.name).toLocaleLowerCase("ru-RU") === normalized,
  );
}

export type ReplyTemplateInput = {
  name: string;
  bodies: TemplateBodies;
  isEnabledForMessages: boolean;
  isEnabledForComments: boolean;
};

export async function createReplyTemplate(
  supabase: SupabaseClient,
  workspaceId: string,
  input: ReplyTemplateInput,
): Promise<ReplyTemplateResult<ReplyTemplateRow>> {
  const validation = validateTemplate(input);

  if (!validation.ok) {
    return validation;
  }
  if (await hasNameConflict(supabase, workspaceId, validation.value.name)) {
    return { ok: false, error: "Шаблон с таким названием уже существует." };
  }

  const { data: last, error: orderError } = await supabase
    .from("reply_templates")
    .select("sort_order")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    console.error("[settings/templates] failed to resolve template order", orderError);
    return { ok: false, error: "Не удалось добавить шаблон." };
  }

  const { data, error } = await supabase
    .from("reply_templates")
    .insert({
      workspace_id: workspaceId,
      name: validation.value.name,
      bodies: validation.value.bodies,
      is_enabled_for_messages: validation.value.isEnabledForMessages,
      is_enabled_for_comments: validation.value.isEnabledForComments,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[settings/templates] failed to create template", error);
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Шаблон с таким названием уже существует."
          : "Не удалось добавить шаблон.",
    };
  }

  return { ok: true, data: data as ReplyTemplateRow };
}

export async function updateReplyTemplate(
  supabase: SupabaseClient,
  workspaceId: string,
  input: ReplyTemplateInput & { id: string },
): Promise<ReplyTemplateResult<ReplyTemplateRow>> {
  const validation = validateTemplate(input);

  if (!validation.ok) {
    return validation;
  }
  if (await hasNameConflict(supabase, workspaceId, validation.value.name, input.id)) {
    return { ok: false, error: "Шаблон с таким названием уже существует." };
  }

  const { data, error } = await supabase
    .from("reply_templates")
    .update({
      name: validation.value.name,
      bodies: validation.value.bodies,
      is_enabled_for_messages: validation.value.isEnabledForMessages,
      is_enabled_for_comments: validation.value.isEnabledForComments,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", input.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[settings/templates] failed to update template", error);
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Шаблон с таким названием уже существует."
          : "Не удалось сохранить шаблон.",
    };
  }
  if (!data) {
    return { ok: false, error: "Шаблон не найден." };
  }

  return { ok: true, data: data as ReplyTemplateRow };
}

export async function deleteReplyTemplate(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<ReplyTemplateResult<null>> {
  const { data, error } = await supabase
    .from("reply_templates")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[settings/templates] failed to delete template", error);
    return { ok: false, error: "Не удалось удалить шаблон." };
  }
  if (!data) {
    return { ok: false, error: "Шаблон не найден." };
  }

  return { ok: true, data: null };
}
