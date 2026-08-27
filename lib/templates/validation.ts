/**
 * Контракт шаблона ответа, общий для браузерного редактора и серверных экшенов
 * (тот же приём, что у `lib/knowledge-base/files.ts`).
 *
 * Лимиты повторяют CHECK-констрейнты `reply_templates`, поэтому значение,
 * прошедшее здесь, не может упасть на стороне базы.
 */

import { isTemplateBodyKey } from "@/lib/i18n/template-languages";

export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_TEMPLATE_BODIES_BYTES = 256 * 1024;

/**
 * Тексты шаблона: ключ → текст. Ключ — это язык плюс номер варианта
 * (`ru`, `ru-2`), см. `parseTemplateBodyKey`: на одном языке у шаблона может
 * быть несколько формулировок.
 */
export type TemplateBodies = Record<string, string>;

export type TemplateInput = {
  name: string;
  bodies: TemplateBodies;
  isEnabledForMessages: boolean;
  isEnabledForComments: boolean;
};

export type TemplateValidationResult =
  | { ok: true; value: TemplateInput }
  | { ok: false; error: string };

/** Управляющие символы запрещены и в базе (`reply_templates_name_characters_check`). */
const FORBIDDEN_NAME_CHARACTERS = /\p{Cc}/u;

export function validateTemplate(input: {
  name: string;
  bodies: TemplateBodies;
  isEnabledForMessages: boolean;
  isEnabledForComments: boolean;
}): TemplateValidationResult {
  const name = input.name.trim();

  if (!name) {
    return { ok: false, error: "Введите название шаблона." };
  }
  if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
    return {
      ok: false,
      error: `Название не должно быть длиннее ${MAX_TEMPLATE_NAME_LENGTH} символов.`,
    };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return { ok: false, error: "Название не должно содержать управляющие символы." };
  }

  const bodies: TemplateBodies = {};

  for (const [key, rawText] of Object.entries(input.bodies)) {
    if (!isTemplateBodyKey(key)) {
      return { ok: false, error: "Неизвестный язык шаблона." };
    }

    const text = rawText.replace(/\r\n?/g, "\n");

    // Вариант без текста не сохраняется: пустая вкладка ничего не добавила бы в
    // поповер, зато засоряла бы список вариантов шаблона.
    if (text.trim()) {
      bodies[key] = text;
    }
  }

  if (Object.keys(bodies).length === 0) {
    return { ok: false, error: "Заполните текст шаблона хотя бы на одном языке." };
  }
  if (
    new TextEncoder().encode(JSON.stringify(bodies)).length >
    MAX_TEMPLATE_BODIES_BYTES
  ) {
    return { ok: false, error: "Тексты шаблона слишком большие. Максимум — 256 КБ." };
  }

  return {
    ok: true,
    value: {
      name,
      bodies,
      isEnabledForMessages: input.isEnabledForMessages,
      isEnabledForComments: input.isEnabledForComments,
    },
  };
}
