import { describe, expect, it } from "vitest";

import {
  MAX_AUTO_REPLY_DELAY_MINUTES,
  MAX_SCENARIO_EXAMPLES,
  validateAutoReplySettings,
  validateScenario,
} from "./validation";

function scenario(overrides: Partial<Parameters<typeof validateScenario>[0]> = {}) {
  return validateScenario({
    name: "Цены",
    condition: "Клиент спрашивает стоимость",
    examples: ["Сколько стоит?"],
    action: "reply",
    replyTemplateId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  });
}

describe("validateScenario", () => {
  it("trims the name, condition and examples", () => {
    const result = scenario({
      name: "  Цены  ",
      condition: "  Клиент спрашивает стоимость  ",
      examples: ["  Сколько стоит?  ", "   "],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Цены",
        condition: "Клиент спрашивает стоимость",
        // Пустой пример не сохраняется: токены в промпте он занимает,
        // классификатору не даёт ничего.
        examples: ["Сколько стоит?"],
        action: "reply",
        replyTemplateId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("requires a name", () => {
    expect(scenario({ name: "   " }).ok).toBe(false);
  });

  it("rejects control characters in the name", () => {
    expect(scenario({ name: "Це\u0007ны" }).ok).toBe(false);
  });

  it("requires something for the classifier to go on", () => {
    // Сценарий из одного названия попадёт в промпт пустым и будет выбираться
    // наугад — это хуже, чем отсутствие сценария.
    const result = scenario({ condition: "  ", examples: [] });

    expect(result).toEqual({
      ok: false,
      error: "Опишите условие сценария или добавьте хотя бы один пример.",
    });
  });

  it("accepts examples without a condition, and the other way round", () => {
    expect(scenario({ condition: "", examples: ["Сколько стоит?"] }).ok).toBe(true);
    expect(scenario({ condition: "Про цены", examples: [] }).ok).toBe(true);
  });

  it("caps the number of examples the way the database does", () => {
    const many = Array.from({ length: MAX_SCENARIO_EXAMPLES + 1 }, (_, i) => `${i}`);

    expect(scenario({ examples: many }).ok).toBe(false);
  });

  it("demands a template when the scenario is set to reply", () => {
    const result = scenario({ replyTemplateId: null });

    expect(result).toEqual({
      ok: false,
      error: "Выберите шаблон ответа или «Не отвечать автоматически».",
    });
  });

  it("drops the template when the scenario is set to stay silent", () => {
    // Констрейнт БД запрещает пару «ignore + шаблон»; здесь это не ошибка
    // ввода, а просто снятый выбор в форме.
    const result = scenario({
      action: "ignore",
      replyTemplateId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.replyTemplateId).toBeNull();
  });
});

describe("validateAutoReplySettings", () => {
  it("accepts a whole number of minutes", () => {
    expect(
      validateAutoReplySettings({
        isEnabled: true,
        delayMinutes: 5,
        fallbackTemplateId: null,
      }),
    ).toEqual({
      ok: true,
      value: { isEnabled: true, delayMinutes: 5, fallbackTemplateId: null },
    });
  });

  it("accepts zero — «отвечать сразу» is a real setting", () => {
    expect(
      validateAutoReplySettings({
        isEnabled: true,
        delayMinutes: 0,
        fallbackTemplateId: null,
      }).ok,
    ).toBe(true);
  });

  it("rejects fractions, negatives and more than a day", () => {
    for (const delayMinutes of [1.5, -1, MAX_AUTO_REPLY_DELAY_MINUTES + 1]) {
      expect(
        validateAutoReplySettings({
          isEnabled: true,
          delayMinutes,
          fallbackTemplateId: null,
        }).ok,
      ).toBe(false);
    }
  });

  it("normalizes an empty fallback choice to null", () => {
    expect(
      validateAutoReplySettings({
        isEnabled: false,
        delayMinutes: 5,
        fallbackTemplateId: "",
      }),
    ).toEqual({
      ok: true,
      value: { isEnabled: false, delayMinutes: 5, fallbackTemplateId: null },
    });
  });
});
