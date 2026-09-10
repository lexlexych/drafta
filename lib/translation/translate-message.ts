import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getMessageTranslation,
  saveMessageTranslation,
  type MessageTranslationView,
} from "@/lib/db/message-translations";

import { TRANSLATION_MAX_SOURCE_LENGTH } from "./budget";
import { translateText } from "./translate-text";

/**
 * Перевод одного сообщения на язык workspace: кэш → маскирование → LLM →
 * размаскирование → кэш.
 *
 * Живёт отдельным модулем, потому что не помещается ни в `lib/ai` (тот чист от
 * БД и логирования), ни в тонкую обёртку server action. В отличие от черновиков
 * это единственный вызов LLM вне Inngest: перевод — короткая интерактивная
 * операция, пользователь ждёт её с открытым спиннером, и очередь с ретраями
 * превратила бы секунду ожидания в неопределённость. Цена решения — ретраев
 * нет: неудача возвращается пользователю как «попробуйте ещё раз».
 */

export type TranslateMessageResult =
  | ({ ok: true } & MessageTranslationView)
  | { ok: false; error: string };

type MessageRow = {
  id: string;
  conversation_id: string;
  text: string;
};

async function loadMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): Promise<MessageRow | null> {
  // Диалог в условии наравне с сообщением: id приходит от клиента, и совпасть
  // должны оба — RLS отсекает чужой workspace, это отсекает чужой тред.
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, text")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    console.error("[translation] failed to load the message", error);
    return null;
  }

  return (data as MessageRow | null) ?? null;
}

export async function translateMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  targetLanguage: string,
  forceRefresh = false,
): Promise<TranslateMessageResult> {
  const message = await loadMessage(
    supabase,
    workspaceId,
    conversationId,
    messageId,
  );

  if (!message) {
    return { ok: false, error: "Сообщение не найдено." };
  }

  const source = message.text.trim();

  if (source.length === 0) {
    return { ok: false, error: "В сообщении нет текста для перевода." };
  }

  if (source.length > TRANSLATION_MAX_SOURCE_LENGTH) {
    return { ok: false, error: "Сообщение слишком длинное для перевода." };
  }

  if (!forceRefresh) {
    const cached = await getMessageTranslation(
      supabase,
      workspaceId,
      messageId,
      targetLanguage,
    );

    if (cached) {
      return { ok: true, ...cached };
    }
  }

  const result = await translateText(workspaceId, source, targetLanguage, "message");
  if (!result.ok) return result;
  const { text, sourceLanguage, provider, model } = result;

  await saveMessageTranslation(supabase, {
    workspaceId,
    conversationId,
    messageId,
    targetLanguage,
    sourceLanguage,
    text,
    provider,
    model,
  });

  return { ok: true, text, sourceLanguage };
}
