/**
 * Язык интерфейса workspace.
 *
 * Хранится в `workspaces.settings.lang` — в том же jsonb-мешке, что и
 * `providerProfiles` (06-data-model.md#workspaces), поэтому отдельной колонки
 * и миграции не требуется. Если поля нет (или значение неизвестно) —
 * английский.
 *
 * Пока это только сохранённое предпочтение: интерфейс на выбранный язык не
 * переключается, интернационализация — отдельная задача.
 */

export const WORKSPACE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "uk", label: "Українська" },
] as const;

export type WorkspaceLanguage = (typeof WORKSPACE_LANGUAGES)[number]["value"];

export const DEFAULT_WORKSPACE_LANGUAGE: WorkspaceLanguage = "en";

export function isWorkspaceLanguage(value: unknown): value is WorkspaceLanguage {
  return WORKSPACE_LANGUAGES.some((language) => language.value === value);
}

/** Язык из `workspaces.settings`; неизвестное или отсутствующее значение — дефолт. */
export function resolveWorkspaceLanguage(settings: unknown): WorkspaceLanguage {
  if (!settings || typeof settings !== "object") {
    return DEFAULT_WORKSPACE_LANGUAGE;
  }

  const lang = (settings as { lang?: unknown }).lang;

  return isWorkspaceLanguage(lang) ? lang : DEFAULT_WORKSPACE_LANGUAGE;
}
