import { AI_SYSTEM_PROMPT_MAX_LENGTH } from "./default-prompts";

export { AI_SYSTEM_PROMPT_MAX_LENGTH };

export type AiSettingsInput = {
  /** Системный промпт черновиков переписки; тон, язык и подпись — внутри него. */
  systemPrompt: string;
  /** Системный промпт черновиков комментариев: публичный ответ звучит иначе. */
  commentSystemPrompt: string;
  model: string;
};

export type AiSettingsValidationResult =
  | { ok: true; data: AiSettingsInput }
  | { ok: false; error: string };

function normalizeRequiredText(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${label}: введите текст.` };
  }

  const normalized = value.trim();

  if (!normalized) {
    return { ok: false, error: `${label}: поле не может быть пустым.` };
  }
  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${label}: максимум ${maxLength} символов.`,
    };
  }

  return { ok: true, value: normalized };
}

export function validateAiSettingsInput(
  input: AiSettingsInput,
  allowedModels: readonly string[],
): AiSettingsValidationResult {
  const systemPrompt = normalizeRequiredText(
    input.systemPrompt,
    "Промпт для сообщений",
    AI_SYSTEM_PROMPT_MAX_LENGTH,
  );
  if (!systemPrompt.ok) {
    return systemPrompt;
  }

  const commentSystemPrompt = normalizeRequiredText(
    input.commentSystemPrompt,
    "Промпт для комментариев",
    AI_SYSTEM_PROMPT_MAX_LENGTH,
  );
  if (!commentSystemPrompt.ok) {
    return commentSystemPrompt;
  }

  if (typeof input.model !== "string") {
    return { ok: false, error: "Выберите модель из списка." };
  }
  const model = input.model.trim();
  if (model && !allowedModels.includes(model)) {
    return { ok: false, error: "Выбранная модель недоступна." };
  }

  return {
    ok: true,
    data: {
      systemPrompt: systemPrompt.value,
      commentSystemPrompt: commentSystemPrompt.value,
      model,
    },
  };
}
