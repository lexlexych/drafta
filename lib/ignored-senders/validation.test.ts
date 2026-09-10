import { describe, expect, it } from "vitest";

import {
  normalizeHandleIdentifier,
  normalizeIgnoredSenderIdentifier,
  normalizePhoneIdentifier,
  validateIgnoredSender,
} from "./validation";

describe("normalizePhoneIdentifier", () => {
  it("приводит любую человеческую запись номера к цифрам E.164", () => {
    expect(normalizePhoneIdentifier("+49 151 2345678")).toBe("491512345678");
    expect(normalizePhoneIdentifier("0049 151 2345678")).toBe("491512345678");
    expect(normalizePhoneIdentifier("(49) 151-234 56 78")).toBe("491512345678");
    expect(normalizePhoneIdentifier("  491512345678  ")).toBe("491512345678");
  });

  /**
   * Ключевой кейс: кандидатов гейт берёт из события, и среди них всегда есть
   * внутренний ID Zernio. Без проверки формы он превратился бы в короткий номер
   * «60214», способный совпасть с чужим исключением.
   */
  it("не принимает внутренний ID провайдера за номер", () => {
    expect(normalizePhoneIdentifier("wa_user_60214")).toBeNull();
    expect(normalizePhoneIdentifier("ig_user_31220")).toBeNull();
    expect(normalizePhoneIdentifier("wa_chat_12938")).toBeNull();
  });

  it("требует международный формат и разумную длину", () => {
    expect(normalizePhoneIdentifier("0151 2345678")).toBeNull();
    expect(normalizePhoneIdentifier("12345")).toBeNull();
    expect(normalizePhoneIdentifier("4915123456789012")).toBeNull();
    expect(normalizePhoneIdentifier("")).toBeNull();
  });
});

describe("normalizeHandleIdentifier", () => {
  it("снимает «@», ссылку на профиль и регистр", () => {
    expect(normalizeHandleIdentifier("@Lena.Fischer")).toBe("lena.fischer");
    expect(normalizeHandleIdentifier("https://instagram.com/lena.fischer/")).toBe(
      "lena.fischer",
    );
    expect(normalizeHandleIdentifier("https://www.instagram.com/lena.fischer")).toBe(
      "lena.fischer",
    );
    expect(normalizeHandleIdentifier("  LENA.FISCHER ")).toBe("lena.fischer");
  });

  it("отказывает на том, что хэндлом Instagram быть не может", () => {
    expect(normalizeHandleIdentifier("lena fischer")).toBeNull();
    expect(normalizeHandleIdentifier("lena-fischer")).toBeNull();
    expect(normalizeHandleIdentifier("лена")).toBeNull();
    expect(normalizeHandleIdentifier("l".repeat(31))).toBeNull();
    expect(normalizeHandleIdentifier("@")).toBeNull();
  });
});

describe("normalizeIgnoredSenderIdentifier", () => {
  it("выбирает нормализацию по платформе", () => {
    expect(normalizeIgnoredSenderIdentifier("whatsapp", "+49 151 2345678")).toBe(
      "491512345678",
    );
    expect(normalizeIgnoredSenderIdentifier("instagram", "@Lena.Fischer")).toBe(
      "lena.fischer",
    );
  });

  it("молчит для платформы без списка исключений", () => {
    expect(normalizeIgnoredSenderIdentifier("telegram", "+49 151 2345678")).toBeNull();
    expect(normalizeIgnoredSenderIdentifier("facebook", "lena.fischer")).toBeNull();
  });
});

describe("validateIgnoredSender", () => {
  it("возвращает нормализованное значение и подрезанное имя", () => {
    const result = validateIgnoredSender({
      platform: "whatsapp",
      identifier: " +49 151 2345678 ",
      label: "  Анна  ",
    });

    expect(result).toEqual({
      ok: true,
      value: { platform: "whatsapp", identifier: "491512345678", label: "Анна" },
    });
  });

  it("разрешает пустое имя — чип тогда показывает один адрес", () => {
    const result = validateIgnoredSender({
      platform: "instagram",
      identifier: "@lena.fischer",
      label: "",
    });

    expect(result).toEqual({
      ok: true,
      value: { platform: "instagram", identifier: "lena.fischer", label: "" },
    });
  });

  it("объясняет, что именно не так с номером", () => {
    expect(
      validateIgnoredSender({ platform: "whatsapp", identifier: "", label: "" }),
    ).toEqual({ ok: false, error: "Введите номер телефона." });

    const national = validateIgnoredSender({
      platform: "whatsapp",
      identifier: "0151 2345678",
      label: "",
    });
    expect(national.ok).toBe(false);
    expect(national.ok === false && national.error).toContain("международном формате");

    const tooShort = validateIgnoredSender({
      platform: "whatsapp",
      identifier: "12345",
      label: "",
    });
    expect(tooShort.ok === false && tooShort.error).toContain("от 7 до 15 цифр");

    const letters = validateIgnoredSender({
      platform: "whatsapp",
      identifier: "Анна",
      label: "",
    });
    expect(letters.ok === false && letters.error).toContain("только цифры");
  });

  it("объясняет, что не так с хэндлом", () => {
    expect(
      validateIgnoredSender({ platform: "instagram", identifier: " ", label: "" }),
    ).toEqual({ ok: false, error: "Введите имя пользователя Instagram." });

    const bad = validateIgnoredSender({
      platform: "instagram",
      identifier: "lena-fischer",
      label: "",
    });
    expect(bad.ok === false && bad.error).toContain("латинских букв");

    const long = validateIgnoredSender({
      platform: "instagram",
      identifier: `@${"l".repeat(31)}`,
      label: "",
    });
    expect(long.ok === false && long.error).toContain("длиннее 30");
  });

  it("проверяет имя так же строго, как база", () => {
    const long = validateIgnoredSender({
      platform: "whatsapp",
      identifier: "+491512345678",
      label: "и".repeat(121),
    });
    expect(long.ok === false && long.error).toContain("длиннее 120");

    const control = validateIgnoredSender({
      platform: "whatsapp",
      identifier: "+491512345678",
      label: "Анна",
    });
    expect(control.ok === false && control.error).toContain("управляющие символы");
  });

  it("не принимает платформу без списка исключений", () => {
    const result = validateIgnoredSender({
      platform: "telegram",
      identifier: "+491512345678",
      label: "Анна",
    });

    expect(result).toEqual({
      ok: false,
      error: "Исключения доступны только для WhatsApp и Instagram.",
    });
  });
});
