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
  getMessageTranslation,
  saveMessageTranslation,
  type MessageTranslationView,
} from "@/lib/db/message-translations";
import { templateLanguageLabel } from "@/lib/i18n/template-languages";

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

/**
 * Потолок длины оригинала. Сообщения в мессенджерах на порядок короче; всё, что
 * длиннее, — это почта или вставленный документ, где один вызов рискует упереться
 * в контекст и таймаут провайдера (30 с, `AI_REQUEST_TIMEOUT_MS`). Отказываем
 * явно, а не режем текст молча: половина перевода хуже его отсутствия.
 */
export const TRANSLATION_MAX_SOURCE_LENGTH = 8000;

export type TranslateMessageResult =
  | ({ ok: true } & MessageTranslationView)
  | { ok: false; error: string };

type MessageRow = {
  id: string;
  conversation_id: string;
  text: string;
};

/**
 * Бюджет ответа. Перевод примерно той же длины, что оригинал, но кириллица и
 * греческий дают заметно больше токенов на символ, чем латиница, поэтому берём
 * с запасом — упереться в `max_tokens` значит получить обрезанный текст.
 */
function completionBudget(sourceLength: number): number {
  return Math.min(4000, Math.ceil(sourceLength / 2) + 256);
}

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

  const cached = await getMessageTranslation(
    supabase,
    workspaceId,
    messageId,
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
      // Перевод — механическая задача: разброс здесь означает только то, что
      // одно и то же сообщение переведётся по-разному.
      temperature: 0,
      maxTokens: completionBudget(source.length),
      // Модель не задаём: `selectProviderModel` возьмёт провайдерский дефолт.
      // Модель из настроек workspace выбрана под генерацию черновиков, а
      // перевод — дешёвая операция, которой незачем ехать на дорогой модели.
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
        surface: "message",
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
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    }),
    recordAiRequest({
      workspaceId,
      operation: "translation",
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      exchange: completion.exchange,
      usage: completion.usage,
    }),
  ]);

  const parsed = parseTranslationCompletion(completion.text);
  const text = unmaskText(parsed.text, masked.entities).trim();

  if (text.length === 0) {
    // Модель прислала один заголовок `SOURCE:` и ничего под ним. Пустой пузырь
    // выглядел бы как удалённое сообщение, поэтому это ошибка, а не результат.
    console.error("[translation] completion carried no translated text");
    return { ok: false, error: "Не удалось перевести — попробуйте ещё раз." };
  }

  await saveMessageTranslation(supabase, {
    workspaceId,
    conversationId,
    messageId,
    targetLanguage,
    sourceLanguage: parsed.sourceLanguage,
    text,
    provider: completion.provider,
    model: completion.model,
  });

  return { ok: true, text, sourceLanguage: parsed.sourceLanguage };
}
