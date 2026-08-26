import { describe, expect, it } from "vitest";

import { WORKSPACE_LANGUAGES } from "./languages";
import {
  TEMPLATE_LANGUAGES,
  defaultTemplateLanguage,
  isTemplateLanguage,
  sortTemplateLanguages,
  templateLanguageLabel,
} from "./template-languages";

describe("template languages", () => {
  it("предлагает двадцать языков без повторов", () => {
    expect(TEMPLATE_LANGUAGES).toHaveLength(20);
    expect(
      new Set(TEMPLATE_LANGUAGES.map((entry) => entry.value)).size,
    ).toBe(20);
  });

  it("включает в себя все языки интерфейса", () => {
    for (const language of WORKSPACE_LANGUAGES) {
      expect(isTemplateLanguage(language.value)).toBe(true);
    }
  });

  it("даёт новому шаблону язык из настроек аккаунта", () => {
    expect(defaultTemplateLanguage("de")).toBe("de");
    expect(defaultTemplateLanguage("uk")).toBe("uk");
  });

  it("валидирует код языка", () => {
    expect(isTemplateLanguage("ja")).toBe(true);
    expect(isTemplateLanguage("xx")).toBe(false);
    expect(isTemplateLanguage(undefined)).toBe(false);
  });

  it("показывает название на самом языке, неизвестный код — как есть", () => {
    expect(templateLanguageLabel("ru")).toBe("Русский");
    expect(templateLanguageLabel("xx")).toBe("xx");
  });

  it("ставит язык воркспейса первым, остальные — по порядку списка", () => {
    expect(sortTemplateLanguages(["ja", "en", "de"], "de")).toEqual([
      "de",
      "en",
      "ja",
    ]);
    // Код вне списка уезжает в конец, а не в начало.
    expect(sortTemplateLanguages(["xx", "en"], "ru")).toEqual(["en", "xx"]);
  });
});
