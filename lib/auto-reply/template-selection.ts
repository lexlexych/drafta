/**
 * Выбор текста шаблона под язык клиента.
 *
 * У шаблона на один язык может быть несколько формулировок (`ru`, `ru-2`,
 * `ru-3` — см. `lib/i18n/template-languages.ts`), и заведены они были ровно
 * против того, что автоответ и делает: десять одинаковых дословных реплик
 * подряд читаются как робот. Поэтому вариант выбирается случайно.
 *
 * Модуль чистый: генератор случайности инжектируется, чтобы тест был
 * детерминированным, а пайплайн мог записать выбранный ключ в журнал.
 */

import {
  isTemplateLanguage,
  parseTemplateBodyKey,
} from "@/lib/i18n/template-languages";

export type TemplateBodyChoice = {
  /** Ключ `reply_templates.bodies` — он же попадает в журнал решений. */
  key: string;
  text: string;
};

/**
 * Приводит код языка от модели к языку шаблонов.
 *
 * Модель охотно отвечает локалью (`de-de`, `pt-br`), а вкладки шаблона
 * подписаны языком (`de`, `pt`). Сужение до базового кода — не догадка: клиент,
 * пишущий на `de-at`, читает немецкий шаблон без потерь. Всё остальное —
 * `null`, и это решение промолчать.
 */
export function normalizeTemplateLanguage(
  language: string | null | undefined,
): string | null {
  if (!language) {
    return null;
  }

  const lower = language.toLowerCase();

  if (isTemplateLanguage(lower)) {
    return lower;
  }

  const base = lower.split("-")[0]!;

  return isTemplateLanguage(base) ? base : null;
}

/**
 * Ключи шаблона на этом языке, в стабильном порядке (по номеру варианта).
 * Порядок нужен не интерфейсу, а воспроизводимости: с ним «случайный выбор»
 * при заданном генераторе — это функция, а не лотерея.
 */
export function templateBodyKeysForLanguage(
  bodies: Readonly<Record<string, string>>,
  language: string,
): string[] {
  return Object.entries(bodies)
    .filter(([key, text]) => {
      const parsed = parseTemplateBodyKey(key);

      return (
        parsed !== null && parsed.language === language && text.trim().length > 0
      );
    })
    .sort(
      ([a], [b]) =>
        (parseTemplateBodyKey(a)?.variant ?? 0) -
        (parseTemplateBodyKey(b)?.variant ?? 0),
    )
    .map(([key]) => key);
}

/**
 * Текст автоответа на языке клиента, или `null`.
 *
 * `null` — это не сбой, а решение промолчать: язык не определён, язык не из
 * списка языков шаблонов, либо у шаблона нет текста именно на нём. Отвечать на
 * чужом языке автоответчик не вправе — оператор выбирал формулировки для
 * конкретных языков, и подмена превратила бы шаблон в отсебятину.
 */
export function pickTemplateBody(
  bodies: Readonly<Record<string, string>>,
  language: string | null,
  random: () => number = Math.random,
): TemplateBodyChoice | null {
  const normalized = normalizeTemplateLanguage(language);

  if (!normalized) {
    return null;
  }

  const keys = templateBodyKeysForLanguage(bodies, normalized);

  if (keys.length === 0) {
    return null;
  }

  const key = keys[Math.min(Math.floor(random() * keys.length), keys.length - 1)]!;

  return { key, text: bodies[key]! };
}
