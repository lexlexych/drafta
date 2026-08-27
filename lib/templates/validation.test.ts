import { describe, expect, it } from "vitest";

import { MAX_TEMPLATE_NAME_LENGTH, validateTemplate } from "./validation";

const base = {
  name: "Доставка",
  bodies: { de: "Zwei Werktage." },
  isEnabledForMessages: true,
  isEnabledForComments: false,
};

function expectError(result: ReturnType<typeof validateTemplate>): string {
  if (result.ok) {
    throw new Error("ожидалась ошибка валидации");
  }

  return result.error;
}

describe("validateTemplate", () => {
  it("подрезает имя и нормализует переводы строк", () => {
    const result = validateTemplate({
      ...base,
      name: "  Доставка  ",
      bodies: { de: "Erste\r\nZweite\rDritte" },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Доставка",
        bodies: { de: "Erste\nZweite\nDritte" },
        isEnabledForMessages: true,
        isEnabledForComments: false,
      },
    });
  });

  it("требует название", () => {
    expect(expectError(validateTemplate({ ...base, name: "   " }))).toContain(
      "название",
    );
    expect(
      expectError(
        validateTemplate({ ...base, name: "x".repeat(MAX_TEMPLATE_NAME_LENGTH + 1) }),
      ),
    ).toContain(String(MAX_TEMPLATE_NAME_LENGTH));
  });

  it("выбрасывает языки без текста и требует хотя бы один", () => {
    const result = validateTemplate({
      ...base,
      bodies: { de: "Text", en: "   ", ru: "" },
    });

    expect(result.ok && result.value.bodies).toEqual({ de: "Text" });
    expect(
      expectError(validateTemplate({ ...base, bodies: { de: " ", en: "" } })),
    ).toContain("хотя бы на одном языке");
  });

  it("не пропускает язык вне списка", () => {
    expect(
      expectError(validateTemplate({ ...base, bodies: { xx: "Text" } })),
    ).toBe("Неизвестный язык шаблона.");
  });

  it("принимает несколько вариантов на один язык", () => {
    const result = validateTemplate({
      ...base,
      bodies: { ru: "Первый вариант", "ru-2": "Второй вариант", de: "Text" },
    });

    expect(result.ok && result.value.bodies).toEqual({
      ru: "Первый вариант",
      "ru-2": "Второй вариант",
      de: "Text",
    });
  });

  it("не пропускает номер варианта вне формата", () => {
    // `ru-1` — это `ru`; ноль, сотня и вариант несуществующего языка тоже нет.
    for (const key of ["ru-1", "ru-0", "ru-100", "xx-2"]) {
      expect(
        expectError(validateTemplate({ ...base, bodies: { [key]: "Text" } })),
      ).toBe("Неизвестный язык шаблона.");
    }
  });

  it("ограничивает суммарный размер текстов", () => {
    expect(
      expectError(
        validateTemplate({ ...base, bodies: { de: "ä".repeat(200_000) } }),
      ),
    ).toContain("256 КБ");
  });

  it("допускает шаблон, выключенный для обеих поверхностей", () => {
    const result = validateTemplate({
      ...base,
      isEnabledForMessages: false,
      isEnabledForComments: false,
    });

    expect(result.ok).toBe(true);
  });
});
