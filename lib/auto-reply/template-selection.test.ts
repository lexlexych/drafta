import { describe, expect, it } from "vitest";

import {
  normalizeTemplateLanguage,
  pickTemplateBody,
  templateBodyKeysForLanguage,
} from "./template-selection";

const bodies = {
  ru: "Мы делаем всё",
  "ru-2": "Список услуг на сайте",
  "ru-3": "Расскажем по телефону",
  de: "Wir machen alles",
  en: "   ",
};

describe("normalizeTemplateLanguage", () => {
  it("keeps a language the templates know", () => {
    expect(normalizeTemplateLanguage("de")).toBe("de");
    expect(normalizeTemplateLanguage("DE")).toBe("de");
  });

  it("narrows a locale to its language", () => {
    // Модель отвечает «de-de», а вкладки шаблона подписаны «de».
    expect(normalizeTemplateLanguage("de-de")).toBe("de");
    expect(normalizeTemplateLanguage("pt-br")).toBe("pt");
  });

  it("gives up on anything else", () => {
    expect(normalizeTemplateLanguage(null)).toBeNull();
    expect(normalizeTemplateLanguage("")).toBeNull();
    expect(normalizeTemplateLanguage("klingon")).toBeNull();
  });
});

describe("templateBodyKeysForLanguage", () => {
  it("collects every variant of one language, ordered", () => {
    expect(templateBodyKeysForLanguage(bodies, "ru")).toEqual([
      "ru",
      "ru-2",
      "ru-3",
    ]);
  });

  it("skips a variant whose text is blank", () => {
    // Пустая вкладка в редакторе не сохраняется, но пробелы в старых данных
    // отвечать клиенту пробелом не должны.
    expect(templateBodyKeysForLanguage(bodies, "en")).toEqual([]);
  });
});

describe("pickTemplateBody", () => {
  it("returns the only variant there is", () => {
    expect(pickTemplateBody(bodies, "de")).toEqual({
      key: "de",
      text: "Wir machen alles",
    });
  });

  it("picks a variant at random, so replies do not read as one robot", () => {
    expect(pickTemplateBody(bodies, "ru", () => 0)).toEqual({
      key: "ru",
      text: "Мы делаем всё",
    });
    expect(pickTemplateBody(bodies, "ru", () => 0.5)).toEqual({
      key: "ru-2",
      text: "Список услуг на сайте",
    });
    // Math.random() ниже 1, но генератор в тесте может вернуть и её — индекс не
    // должен выйти за массив.
    expect(pickTemplateBody(bodies, "ru", () => 1)).toEqual({
      key: "ru-3",
      text: "Расскажем по телефону",
    });
  });

  it("stays silent when the language is unknown", () => {
    // Требование фичи: язык не определён — не отправлять ничего.
    expect(pickTemplateBody(bodies, null)).toBeNull();
  });

  it("stays silent when the template has no text in that language", () => {
    // Отвечать на другом языке автоответчик не вправе: оператор выбирал
    // формулировки под конкретные языки.
    expect(pickTemplateBody(bodies, "fr")).toBeNull();
  });
});
