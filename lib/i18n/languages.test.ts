import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_LANGUAGE,
  WORKSPACE_LANGUAGES,
  isWorkspaceLanguage,
  resolveWorkspaceLanguage,
} from "./languages";

describe("workspace languages", () => {
  it("предлагает четыре языка, каждый — на своём языке", () => {
    expect(WORKSPACE_LANGUAGES.map((entry) => entry.value)).toEqual([
      "en",
      "de",
      "ru",
      "uk",
    ]);
    expect(WORKSPACE_LANGUAGES.map((entry) => entry.label)).toEqual([
      "English",
      "Deutsch",
      "Русский",
      "Українська",
    ]);
  });

  it("по умолчанию — английский", () => {
    expect(DEFAULT_WORKSPACE_LANGUAGE).toBe("en");
    expect(resolveWorkspaceLanguage({})).toBe("en");
    expect(resolveWorkspaceLanguage(null)).toBe("en");
    expect(resolveWorkspaceLanguage({ providerProfiles: {} })).toBe("en");
  });

  it("берёт язык из settings.lang и игнорирует неизвестные значения", () => {
    expect(resolveWorkspaceLanguage({ lang: "de" })).toBe("de");
    expect(resolveWorkspaceLanguage({ lang: "uk" })).toBe("uk");
    expect(resolveWorkspaceLanguage({ lang: "fr" })).toBe("en");
    expect(resolveWorkspaceLanguage({ lang: 42 })).toBe("en");
  });

  it("валидирует значение перед записью", () => {
    expect(isWorkspaceLanguage("ru")).toBe(true);
    expect(isWorkspaceLanguage("fr")).toBe(false);
    expect(isWorkspaceLanguage(undefined)).toBe(false);
  });
});
