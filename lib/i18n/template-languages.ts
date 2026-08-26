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

/** Языки шаблона в порядке списка; язык воркспейса — всегда первым. */
export function sortTemplateLanguages(
  languages: readonly string[],
  preferred: TemplateLanguage,
): string[] {
  const order = TEMPLATE_LANGUAGES.map((language) => language.value) as string[];
  // Неизвестный код (язык убрали из списка, а шаблон с ним остался) уезжает в
  // конец, а не в начало, как дал бы сырой indexOf === -1.
  const rank = (value: string) => {
    const index = order.indexOf(value);

    return index === -1 ? order.length : index;
  };

  return [...languages].sort((a, b) => {
    if (a === preferred) return -1;
    if (b === preferred) return 1;

    return rank(a) - rank(b);
  });
}
