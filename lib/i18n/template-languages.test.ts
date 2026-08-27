import { describe, expect, it } from "vitest";

import { WORKSPACE_LANGUAGES } from "./languages";
import {
  TEMPLATE_LANGUAGES,
  buildTemplateBodyKey,
  defaultTemplateLanguage,
  isTemplateBodyKey,
  isTemplateLanguage,
  nextTemplateBodyKey,
  parseTemplateBodyKey,
  renumberTemplateBodyKeys,
  sortTemplateBodyKeys,
  templateBodyKeyLabel,
  templateBodyKeyShortLabel,
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
    expect(sortTemplateBodyKeys(["ja", "en", "de"], "de")).toEqual([
      "de",
      "en",
      "ja",
    ]);
    // Код вне списка уезжает в конец, а не в начало.
    expect(sortTemplateBodyKeys(["xx", "en"], "ru")).toEqual(["en", "xx"]);
  });
});

describe("ключи текстов шаблона", () => {
  it("разбирает голый код как первый вариант, а суффикс — как номер", () => {
    expect(parseTemplateBodyKey("ru")).toEqual({ language: "ru", variant: 1 });
    expect(parseTemplateBodyKey("ru-2")).toEqual({ language: "ru", variant: 2 });
    expect(parseTemplateBodyKey("ru-10")).toEqual({ language: "ru", variant: 10 });
  });

  it("не принимает несуществующий язык и номер вне диапазона", () => {
    // `ru-1` быть не должно: первый вариант — это голый код, иначе один и тот
    // же текст получил бы два разных ключа.
    expect(parseTemplateBodyKey("ru-1")).toBeNull();
    expect(parseTemplateBodyKey("ru-0")).toBeNull();
    expect(parseTemplateBodyKey("ru-100")).toBeNull();
    expect(parseTemplateBodyKey("xx-2")).toBeNull();
    expect(parseTemplateBodyKey("ru-2-3")).toBeNull();
    expect(isTemplateBodyKey("ru-2")).toBe(true);
    expect(isTemplateBodyKey("ru-1")).toBe(false);
    expect(isTemplateBodyKey(42)).toBe(false);
  });

  it("собирает ключ обратно", () => {
    expect(buildTemplateBodyKey("ru", 1)).toBe("ru");
    expect(buildTemplateBodyKey("ru", 3)).toBe("ru-3");
  });

  it("выдаёт следующий свободный номер для языка", () => {
    expect(nextTemplateBodyKey("ru", [])).toBe("ru");
    expect(nextTemplateBodyKey("ru", ["de", "ru"])).toBe("ru-2");
    expect(nextTemplateBodyKey("ru", ["ru", "ru-2"])).toBe("ru-3");
    // Дырку в нумерации занимаем, а не проскакиваем.
    expect(nextTemplateBodyKey("ru", ["ru", "ru-3"])).toBe("ru-2");
  });

  it("закрывает дырки после удаления варианта", () => {
    expect(
      renumberTemplateBodyKeys({ ru: "первый", "ru-3": "третий", de: "Text" }),
    ).toEqual({ ru: "первый", "ru-2": "третий", de: "Text" });
    // Неизвестный ключ переносится как есть, а не теряется.
    expect(renumberTemplateBodyKeys({ xx: "?" })).toEqual({ xx: "?" });
  });

  it("подписывает варианты полно и коротко", () => {
    expect(templateBodyKeyLabel("ru")).toBe("Русский");
    expect(templateBodyKeyLabel("ru-2")).toBe("Русский · 2");
    expect(templateBodyKeyShortLabel("ru-2")).toBe("ru-2");
  });

  it("сортирует варианты одного языка по номеру", () => {
    expect(sortTemplateBodyKeys(["ru-2", "de", "ru", "de-2"], "ru")).toEqual([
      "ru",
      "ru-2",
      "de",
      "de-2",
    ]);
  });
});
