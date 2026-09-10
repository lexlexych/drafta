import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIN_PASSWORD_LENGTH, validateNewPassword } from "./password";

describe("validateNewPassword", () => {
  it("accepts a long enough password that matches its confirmation", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH);

    expect(validateNewPassword(password, password)).toEqual({ ok: true });
  });

  it("rejects a password one character below the threshold", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = validateNewPassword(password, password);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe(
      `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`,
    );
  });

  it("rejects a mismatched confirmation", () => {
    const result = validateNewPassword("correct-horse", "correct-horsе");

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe("Пароли не совпадают.");
  });

  it("reports the length problem before the mismatch", () => {
    const result = validateNewPassword("short", "other");

    expect(result.ok ? null : result.error).toContain("не менее");
  });

  // Порог живёт в двух местах — в коде и в конфиге Supabase. Тест держит их
  // связанными: если серверный минимум поднимут выше нашего, форма начала бы
  // пропускать пароли, которые Supabase потом отвергнет.
  it("is at least as strict as the Supabase minimum", () => {
    const config = readFileSync(
      join(process.cwd(), "supabase", "config.toml"),
      "utf8",
    );
    const match = config.match(/^minimum_password_length\s*=\s*(\d+)/m);

    expect(match).not.toBeNull();
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(Number(match?.[1]));
  });
});
