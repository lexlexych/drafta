import { describe, expect, it } from "vitest";

import {
  AI_SYSTEM_PROMPT_MAX_LENGTH,
  validateAiSettingsInput,
  type AiSettingsInput,
} from "./settings";

const allowedModels = ["mistral-small-latest", "mistral-large-latest"];

function validInput(overrides: Partial<AiSettingsInput> = {}): AiSettingsInput {
  return {
    systemPrompt: "Пиши от лица бизнеса.",
    commentSystemPrompt: "Отвечай на комментарии коротко.",
    model: "",
    ...overrides,
  };
}

describe("validateAiSettingsInput", () => {
  it("accepts auto and allowlisted models but rejects an unknown model", () => {
    expect(validateAiSettingsInput(validInput({ model: "" }), allowedModels).ok).toBe(
      true,
    );
    expect(
      validateAiSettingsInput(
        validInput({ model: "mistral-small-latest" }),
        allowedModels,
      ).ok,
    ).toBe(true);
    expect(
      validateAiSettingsInput(validInput({ model: "foreign-model" }), allowedModels),
    ).toEqual({ ok: false, error: "Выбранная модель недоступна." });
  });

  it("enforces prompt limits and normalizes surrounding whitespace", () => {
    expect(
      validateAiSettingsInput(
        validInput({
          systemPrompt: "  Пиши от лица бизнеса.  ",
          commentSystemPrompt: "  Отвечай коротко.  ",
        }),
        allowedModels,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        systemPrompt: "Пиши от лица бизнеса.",
        commentSystemPrompt: "Отвечай коротко.",
      },
    });

    for (const input of [
      validInput({ systemPrompt: "x".repeat(AI_SYSTEM_PROMPT_MAX_LENGTH + 1) }),
      validInput({
        commentSystemPrompt: "x".repeat(AI_SYSTEM_PROMPT_MAX_LENGTH + 1),
      }),
    ]) {
      expect(validateAiSettingsInput(input, allowedModels).ok).toBe(false);
    }
  });

  // Пустой промпт оставил бы модель вообще без роли, поэтому оба поля
  // обязательные — в отличие от прежней подписи, которая могла быть пустой.
  it.each([
    ["systemPrompt", "Промпт для сообщений: поле не может быть пустым."],
    ["commentSystemPrompt", "Промпт для комментариев: поле не может быть пустым."],
  ] as const)("rejects an empty %s", (field, error) => {
    expect(
      validateAiSettingsInput(validInput({ [field]: "   " }), allowedModels),
    ).toEqual({ ok: false, error });
  });
});
