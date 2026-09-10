import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getCommentTranslation,
  saveCommentTranslation,
  type CommentTranslationView,
} from "@/lib/db/comment-translations";

import { TRANSLATION_MAX_SOURCE_LENGTH } from "./budget";
import { translateText } from "./translate-text";

/**
 * Перевод одного комментария на язык workspace: кэш → маскирование → LLM →
 * размаскирование → кэш.
 *
 * Зеркало `./translate-message.ts` со всеми его решениями: синхронный вызов вне
 * Inngest (пользователь ждёт со спиннером, и очередь с ретраями превратила бы
 * секунду ожидания в неопределённость), ценой отсутствия ретраев. Отличается
 * только хранилищем кэша и `surface: "comment"` в журналах AI.
 */

export type TranslateCommentResult =
  | ({ ok: true } & CommentTranslationView)
  | { ok: false; error: string };

type CommentRow = {
  id: string;
  post_id: string;
  text: string;
};

async function loadComment(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  commentId: string,
): Promise<CommentRow | null> {
  // Пост в условии наравне с комментарием: id приходит от клиента, и совпасть
  // должны оба — RLS отсекает чужой workspace, это отсекает чужой пост.
  const { data, error } = await supabase
    .from("comments")
    .select("id, post_id, text")
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .eq("id", commentId)
    .maybeSingle();

  if (error) {
    console.error("[translation] failed to load the comment", error);
    return null;
  }

  return (data as CommentRow | null) ?? null;
}

export async function translateComment(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  commentId: string,
  targetLanguage: string,
  forceRefresh = false,
): Promise<TranslateCommentResult> {
  const comment = await loadComment(supabase, workspaceId, postId, commentId);

  if (!comment) {
    return { ok: false, error: "Комментарий не найден." };
  }

  const source = comment.text.trim();

  if (source.length === 0) {
    return { ok: false, error: "В комментарии нет текста для перевода." };
  }

  if (source.length > TRANSLATION_MAX_SOURCE_LENGTH) {
    return { ok: false, error: "Комментарий слишком длинный для перевода." };
  }

  if (!forceRefresh) {
    const cached = await getCommentTranslation(
      supabase,
      workspaceId,
      commentId,
      targetLanguage,
    );

    if (cached) {
      return { ok: true, ...cached };
    }
  }

  const result = await translateText(workspaceId, source, targetLanguage, "comment");
  if (!result.ok) return result;
  const { text, sourceLanguage, provider, model } = result;

  await saveCommentTranslation(supabase, {
    workspaceId,
    postId,
    commentId,
    targetLanguage,
    sourceLanguage,
    text,
    provider,
    model,
  });

  return { ok: true, text, sourceLanguage };
}
