import "server-only";

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
import { templateLanguageLabel } from "@/lib/i18n/template-languages";
import { completionBudget } from "./budget";

export async function translateText(
  workspaceId: string,
  source: string,
  targetLanguage: string,
  surface: "message" | "comment",
) {
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
      return { ok: false as const, error: "Перевод недоступен: AI-провайдер не настроен." };
    }

    if (error instanceof AiProviderError) {
      // Учёт ведём и на провале — иначе неудачные вызовы исчезают из журнала
      // ровно тогда, когда он нужнее всего (см. draft-pipeline.ts).
      await recordAiRequest({
        workspaceId,
        operation: "translation",
        surface,
        provider: error.provider,
        model: error.model ?? "unknown",
        exchange: error.exchange ?? null,
        usage: null,
        errorCode: error.code,
      });
      console.error("[translation] provider call failed", error);
      return { ok: false as const, error: "Не удалось перевести — попробуйте ещё раз." };
    }

    console.error("[translation] unexpected failure", error);
    return { ok: false as const, error: "Не удалось перевести — попробуйте ещё раз." };
  }

  await Promise.all([
    recordAiUsage({
      workspaceId,
      operation: "translation",
      surface,
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    }),
    recordAiRequest({
      workspaceId,
      operation: "translation",
      surface,
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
    return { ok: false as const, error: "Не удалось перевести — попробуйте ещё раз." };
  }

  return {
    ok: true as const,
    text,
    sourceLanguage: parsed.sourceLanguage,
    provider: completion.provider,
    model: completion.model,
  };
}
