/**
 * Языки шаблонов ответов.
 *
 * Отдельный список от `WORKSPACE_LANGUAGES` (./languages.ts) и сознательно шире
 * его: язык интерфейса выбирает владелец один раз на весь workspace, а отвечать
 * приходится на языке клиента — их у малого бизнеса в ЕС заметно больше четырёх.
 * Обратное включение обязательно: любой язык интерфейса должен находиться и
 * здесь, иначе новому шаблону нечего было бы предложить по умолчанию
 * (см. `defaultTemplateLanguage`, тест это фиксирует).
 *
 * Порядок — как в списке: сначала языки интерфейса, дальше остальные по
 * распространённости. Названия — на самом языке, как и в `WORKSPACE_LANGUAGES`.
 */

import type { WorkspaceLanguage } from "./languages";

export const TEMPLATE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "uk", label: "Українська" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "tr", label: "Türkçe" },
  { value: "ro", label: "Română" },
  { value: "cs", label: "Čeština" },
  { value: "sv", label: "Svenska" },
  { value: "el", label: "Ελληνικά" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
] as const;

export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]["value"];

export function isTemplateLanguage(value: unknown): value is TemplateLanguage {
  return TEMPLATE_LANGUAGES.some((language) => language.value === value);
}

/** Название языка для вкладки; неизвестный код показываем как есть. */
export function templateLanguageLabel(value: string): string {
  return (
    TEMPLATE_LANGUAGES.find((language) => language.value === value)?.label ??
    value
  );
}

/**
 * Язык первой вкладки нового шаблона — язык из «Настройки → Аккаунт».
 * Сужение явное, а не приведением типа: если список интерфейса когда-нибудь
 * разойдётся с этим, шаблон получит понятный дефолт, а не несуществующий язык.
 */
export const FALLBACK_TEMPLATE_LANGUAGE: TemplateLanguage = "en";

export function defaultTemplateLanguage(
  workspaceLanguage: WorkspaceLanguage,
): TemplateLanguage {
  return isTemplateLanguage(workspaceLanguage)
    ? workspaceLanguage
    : FALLBACK_TEMPLATE_LANGUAGE;
}

/* -------------------------------------------------------------------------
 * Ключи `reply_templates.bodies`: язык плюс номер варианта
 * ---------------------------------------------------------------------- */

/**
 * У шаблона может быть несколько формулировок на одном языке — под постом
 * десять одинаковых дословных ответов читаются как спам. Поэтому ключ текста —
 * не просто код языка, а «язык + номер записи»: `ru` (первый вариант), `ru-2`,
 * `ru-3`, …
 *
 * Первый вариант остаётся голым кодом языка: так все шаблоны, созданные до
 * появления вариантов, остаются валидными без миграции данных. Ту же форму
 * проверяет `private.is_language_text_map` в
 * `supabase/migrations/20260827110000_reply_template_variants.sql`.
 */
export type TemplateBodyKey = {
  language: TemplateLanguage;
  /** 1 у голого кода языка, дальше — то, что стоит после дефиса. */
  variant: number;
};

/** Номер второго варианта: первым считается сам код языка. */
const FIRST_NUMBERED_VARIANT = 2;
const MAX_TEMPLATE_VARIANT = 99;

export function parseTemplateBodyKey(key: string): TemplateBodyKey | null {
  const [language, suffix, ...rest] = key.split("-");

  if (rest.length > 0 || !isTemplateLanguage(language)) {
    return null;
  }
  if (suffix === undefined) {
    return { language, variant: 1 };
  }

  // `ru-1` не бывает: первый вариант пишется голым кодом, иначе один и тот же
  // текст имел бы два разных ключа.
  if (!/^[0-9]{1,2}$/.test(suffix)) {
    return null;
  }

  const variant = Number(suffix);

  return variant >= FIRST_NUMBERED_VARIANT && variant <= MAX_TEMPLATE_VARIANT
    ? { language, variant }
    : null;
}

export function isTemplateBodyKey(value: unknown): value is string {
  return typeof value === "string" && parseTemplateBodyKey(value) !== null;
}

export function buildTemplateBodyKey(
  language: TemplateLanguage,
  variant: number,
): string {
  return variant <= 1 ? language : `${language}-${variant}`;
}

/** Ключ для новой вкладки: первый свободный номер у этого языка. */
export function nextTemplateBodyKey(
  language: TemplateLanguage,
  existingKeys: readonly string[],
): string {
  const taken = new Set(existingKeys);

  for (let variant = 1; variant <= MAX_TEMPLATE_VARIANT; variant += 1) {
    const key = buildTemplateBodyKey(language, variant);

    if (!taken.has(key)) {
      return key;
    }
  }

  return buildTemplateBodyKey(language, MAX_TEMPLATE_VARIANT);
}

/** Полное название для поповера и aria-label: «Русский», «Русский · 2». */
export function templateBodyKeyLabel(key: string): string {
  const parsed = parseTemplateBodyKey(key);

  if (!parsed) {
    return key;
  }

  const label = templateLanguageLabel(parsed.language);

  return parsed.variant === 1 ? label : `${label} · ${parsed.variant}`;
}

/**
 * Подпись вкладки — сам ключ (`ru`, `ru-2`). Вкладок у шаблона может быть с
 * десяток, и полные названия («Українська») съедали бы всю строку; полное имя
 * остаётся в выпадающем списке и в подсказке вкладки.
 */
export function templateBodyKeyShortLabel(key: string): string {
  return key;
}

/**
 * Закрывает дырки в нумерации после удаления варианта: `ru`, `ru-3` →
 * `ru`, `ru-2`. Порядок ключей сохраняется, тексты переезжают вместе с ними.
 * Ключи ничем не адресуются извне, поэтому переписывать их безопасно.
 */
export function renumberTemplateBodyKeys(
  bodies: Record<string, string>,
): Record<string, string> {
  const seen = new Map<string, number>();
  const result: Record<string, string> = {};

  for (const [key, text] of Object.entries(bodies)) {
    const parsed = parseTemplateBodyKey(key);

    if (!parsed) {
      result[key] = text;
      continue;
    }

    const variant = (seen.get(parsed.language) ?? 0) + 1;
    seen.set(parsed.language, variant);
    result[buildTemplateBodyKey(parsed.language, variant)] = text;
  }

  return result;
}

/**
 * Ключи в порядке списка языков, внутри языка — по номеру варианта; язык
 * воркспейса всегда первым.
 */
export function sortTemplateBodyKeys(
  keys: readonly string[],
  preferred: TemplateLanguage,
): string[] {
  const order = TEMPLATE_LANGUAGES.map((language) => language.value) as string[];
  // Неизвестный ключ (язык убрали из списка, а шаблон с ним остался) уезжает в
  // конец, а не в начало, как дал бы сырой indexOf === -1.
  const rank = (key: string) => {
    const parsed = parseTemplateBodyKey(key);

    if (!parsed) {
      return { language: order.length, variant: Number.MAX_SAFE_INTEGER };
    }

    return {
      language: parsed.language === preferred ? -1 : order.indexOf(parsed.language),
      variant: parsed.variant,
    };
  };

  return [...keys].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);

    return left.language - right.language || left.variant - right.variant;
  });
}
