import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AiConfigurationError,
  AiProviderError,
  buildTranslationPrompt,
  generateCompletionWithUsage,
  maskText,
  parseTranslationCompletion,
  unmaskText,
} from "@/lib/ai";
import { recordAiRequest } from "@/lib/db/ai-request-log";
import { recordAiUsage } from "@/lib/db/ai-usage";
import {
  getCommentTranslation,
  saveCommentTranslation,
  type CommentTranslationView,
} from "@/lib/db/comment-translations";
import { templateLanguageLabel } from "@/lib/i18n/template-languages";

import { TRANSLATION_MAX_SOURCE_LENGTH, completionBudget } from "./budget";

/**
 * Перевод одного комментария на язык workspace: кэш → маскирование → LLM →
 * размаскирование → кэш.
 *
 * Зеркало `./translate-message.ts` со всеми его решениями: синхронный вызов вне
 * прогоном (пользователь ждёт со спиннером, и очередь с ретраями превратила бы
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

  const cached = await getCommentTranslation(
    supabase,
    workspaceId,
    commentId,
    targetLanguage,
  );

  if (cached) {
    return { ok: true, ...cached };
  }

  // Правило 9: наружу уходит только замаскированный текст, и восстановить его
  // можно лишь по этой карте плейсхолдеров.
  const masked = maskText(source);
  const prompt = buildTranslationPrompt({
    maskedText: masked.maskedText,
    targetLanguage,
    targetLanguageName: templateLanguageLabel(targetLanguage),
  });

  let completion;

  try {
    completion = await generateCompletionWithUsage(prompt, {
      temperature: 0,
      maxTokens: completionBudget(source.length),
    });
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      console.error("[translation] AI provider is not configured", error);
      return { ok: false, error: "Перевод недоступен: AI-провайдер не настроен." };
    }

    if (error instanceof AiProviderError) {
      // Учёт ведём и на провале — иначе неудачные вызовы исчезают из журнала
      // ровно тогда, когда он нужнее всего (см. draft-pipeline.ts).
      await recordAiRequest({
        workspaceId,
        operation: "translation",
        surface: "comment",
        provider: error.provider,
        model: error.model ?? "unknown",
        exchange: error.exchange ?? null,
        usage: null,
        errorCode: error.code,
      });
      console.error("[translation] provider call failed", error);
      return { ok: false, error: "Не удалось перевести — попробуйте ещё раз." };
    }

    console.error("[translation] unexpected failure", error);
    return { ok: false, error: "Не удалось перевести — попробуйте ещё раз." };
  }

  await Promise.all([
    recordAiUsage({
      workspaceId,
      operation: "translation",
      surface: "comment",
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    }),
    recordAiRequest({
      workspaceId,
      operation: "translation",
      surface: "comment",
      provider: completion.provider,
      model: completion.model,
      exchange: completion.exchange,
      usage: completion.usage,
    }),
  ]);

  const parsed = parseTranslationCompletion(completion.text);
  const text = unmaskText(parsed.text, masked.entities).trim();

  if (text.length === 0) {
    // Модель прислала один заголовок `SOURCE:` и ничего под ним.
    console.error("[translation] completion carried no translated text");
    return { ok: false, error: "Не удалось перевести — попробуйте ещё раз." };
  }

  await saveCommentTranslation(supabase, {
    workspaceId,
    postId,
    commentId,
    targetLanguage,
    sourceLanguage: parsed.sourceLanguage,
    text,
    provider: completion.provider,
    model: completion.model,
  });

  return { ok: true, text, sourceLanguage: parsed.sourceLanguage };
}
