import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Кэш переводов комментариев (`public.comment_translations`).
 *
 * Зеркало `./message-translations.ts` для второго ящика — те же решения и по тем
 * же причинам: ключ кэша включает язык, НА который переведено, поэтому смена
 * языка в «Настройки → Аккаунт» не обесценивает уже сделанные переводы, а пишет
 * сюда пользовательский RLS-клиент, потому что перевод запускает участник
 * workspace синхронным server action, а не Inngest-пайплайн.
 */

export type CommentTranslationView = {
  text: string;
  /** `null`, если модель не назвала язык оригинала. */
  sourceLanguage: string | null;
};

export type SaveCommentTranslationInput = {
  workspaceId: string;
  postId: string;
  commentId: string;
  targetLanguage: string;
  sourceLanguage: string | null;
  text: string;
  provider: string;
  model: string;
};

type TranslationRow = {
  comment_id: string;
  text: string;
  source_language: string | null;
};

/**
 * Переводы загруженной страницы комментариев одним запросом — их берёт
 * `getPostThreadView`, чтобы уже переведённый комментарий переключался без сети.
 *
 * `commentIds` — комментарии страницы: тред грузится окном
 * (`lib/db/thread-page.ts`), и переводы не должны ехать за всю ленту поста.
 * Пустой массив — переводить нечего; `null` означает «весь пост».
 *
 * Кэш не критичен для показа треда: если запрос упал, пост всё равно должен
 * открыться, а значок перевода просто сходит в действие. Поэтому пустая карта и
 * `console.error`, а не throw, как у загрузки самих комментариев.
 */
export async function listPostTranslations(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  targetLanguage: string,
  commentIds: readonly string[] | null = null,
): Promise<Map<string, CommentTranslationView>> {
  const map = new Map<string, CommentTranslationView>();

  if (commentIds !== null && commentIds.length === 0) {
    return map;
  }

  let query = supabase
    .from("comment_translations")
    .select("comment_id, text, source_language")
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .eq("target_language", targetLanguage);

  if (commentIds !== null) {
    query = query.in("comment_id", [...commentIds]);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[translation] failed to load cached comment translations", error);
    return map;
  }

  for (const row of (data ?? []) as TranslationRow[]) {
    map.set(row.comment_id, {
      text: row.text,
      sourceLanguage: row.source_language,
    });
  }

  return map;
}

/** Второй уровень защиты после предзагрузки в тред: кэш мог появиться позже. */
export async function getCommentTranslation(
  supabase: SupabaseClient,
  workspaceId: string,
  commentId: string,
  targetLanguage: string,
): Promise<CommentTranslationView | null> {
  const { data, error } = await supabase
    .from("comment_translations")
    .select("comment_id, text, source_language")
    .eq("workspace_id", workspaceId)
    .eq("comment_id", commentId)
    .eq("target_language", targetLanguage)
    .maybeSingle();

  if (error) {
    console.error("[translation] failed to read a cached comment translation", error);
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as TranslationRow;

  return { text: row.text, sourceLanguage: row.source_language };
}

/**
 * Кладёт перевод в кэш. Не бросает: перевод уже получен и показывается
 * пользователю, а несохранённый кэш стоит ровно одного лишнего вызова LLM в
 * следующий раз.
 *
 * `upsert` по ключу кэша, а не `insert`: две вкладки могут нажать перевод
 * одновременно, и проигравшая гонку не должна показать ошибку.
 */
export async function saveCommentTranslation(
  supabase: SupabaseClient,
  input: SaveCommentTranslationInput,
): Promise<void> {
  const { error } = await supabase.from("comment_translations").upsert(
    {
      workspace_id: input.workspaceId,
      post_id: input.postId,
      comment_id: input.commentId,
      target_language: input.targetLanguage,
      source_language: input.sourceLanguage,
      text: input.text,
      provider: input.provider,
      model: input.model,
    },
    { onConflict: "workspace_id,comment_id,target_language" },
  );

  if (error) {
    console.error("[translation] failed to cache a comment translation", error);
  }
}
