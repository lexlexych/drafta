import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Кэш переводов сообщений (`public.message_translations`).
 *
 * Ключ кэша — сообщение плюс язык, НА который переведено, поэтому смена языка в
 * «Настройки → Аккаунт» не обесценивает уже сделанные переводы: они просто
 * перестают совпадать по `target_language`.
 *
 * Пишется пользовательским RLS-клиентом, а не админским: перевод запускает
 * участник workspace синхронным server action, а не Inngest-пайплайн, и RLS
 * здесь — та же граница тенанта, что и для остальных таблиц инбокса.
 */

export type MessageTranslationView = {
  text: string;
  /** `null`, если модель не назвала язык оригинала. */
  sourceLanguage: string | null;
};

export type SaveMessageTranslationInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  targetLanguage: string;
  sourceLanguage: string | null;
  text: string;
  provider: string;
  model: string;
};

type TranslationRow = {
  message_id: string;
  text: string;
  source_language: string | null;
};

/**
 * Переводы загруженной страницы треда одним запросом — их берёт `getThreadView`,
 * чтобы уже переведённое сообщение переключалось без сети.
 *
 * `messageIds` — сообщения страницы: тред грузится окном
 * (`lib/db/thread-page.ts`), и переводы не должны ехать за всю историю. Пустой
 * массив — переводить нечего, запрос не нужен; `null` означает «весь тред».
 *
 * Кэш не критичен для показа переписки: если запрос упал, тред всё равно должен
 * открыться, а значок перевода просто сходит в действие. Поэтому здесь пустая
 * карта и `console.error`, а не throw, как у загрузки самих сообщений.
 */
export async function listConversationTranslations(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  targetLanguage: string,
  messageIds: readonly string[] | null = null,
): Promise<Map<string, MessageTranslationView>> {
  const map = new Map<string, MessageTranslationView>();

  if (messageIds !== null && messageIds.length === 0) {
    return map;
  }

  let query = supabase
    .from("message_translations")
    .select("message_id, text, source_language")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("target_language", targetLanguage);

  if (messageIds !== null) {
    query = query.in("message_id", [...messageIds]);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[translation] failed to load cached translations", error);
    return map;
  }

  for (const row of (data ?? []) as TranslationRow[]) {
    map.set(row.message_id, {
      text: row.text,
      sourceLanguage: row.source_language,
    });
  }

  return map;
}

/** Второй уровень защиты после предзагрузки в тред: кэш мог появиться позже. */
export async function getMessageTranslation(
  supabase: SupabaseClient,
  workspaceId: string,
  messageId: string,
  targetLanguage: string,
): Promise<MessageTranslationView | null> {
  const { data, error } = await supabase
    .from("message_translations")
    .select("message_id, text, source_language")
    .eq("workspace_id", workspaceId)
    .eq("message_id", messageId)
    .eq("target_language", targetLanguage)
    .maybeSingle();

  if (error) {
    console.error("[translation] failed to read a cached translation", error);
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
 * следующий раз — ронять из-за этого готовый ответ незачем.
 *
 * `upsert` по ключу кэша, а не `insert`: две вкладки могут нажать перевод
 * одновременно, и проигравшая гонку не должна показать ошибку.
 */
export async function saveMessageTranslation(
  supabase: SupabaseClient,
  input: SaveMessageTranslationInput,
): Promise<void> {
  const { error } = await supabase.from("message_translations").upsert(
    {
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      target_language: input.targetLanguage,
      source_language: input.sourceLanguage,
      text: input.text,
      provider: input.provider,
      model: input.model,
    },
    { onConflict: "workspace_id,message_id,target_language" },
  );

  if (error) {
    console.error("[translation] failed to cache a translation", error);
  }
}
