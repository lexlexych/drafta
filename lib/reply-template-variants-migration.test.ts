import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а ожидания ниже написаны через LF.
function readMigration(name: string): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", name),
    "utf8",
  ).replaceAll("\r\n", "\n");
}

const migration = readMigration("20260827110000_reply_template_variants.sql");
const original = readMigration("20260826110000_reply_templates.sql");

describe("reply template variants migration contract", () => {
  it("allows a numbered variant after the language code", () => {
    // `ru-2`, `ru-3`, … — вторая и следующие формулировки на одном языке.
    expect(migration).toContain(
      "'^[a-z]{2}(-([a-z]{2}|[2-9]|[1-9][0-9]))?$'",
    );
  });

  it("keeps the locale branch, so already stored keys stay valid", () => {
    // Старая форма ключа — `^[a-z]{2}(-[a-z]{2})?$`. Ветка `[a-z]{2}` в новой
    // остаётся, иначе миграция обесценила бы существующие строки.
    expect(original).toContain("'^[a-z]{2}(-[a-z]{2})?$'");
    expect(migration).toContain("-([a-z]{2}|");
  });

  it("replaces the function instead of touching the constraint", () => {
    // Имя функции зашито в `reply_templates_bodies_shape_check`: заменяем тело,
    // а таблицу, констрейнты и политики не трогаем.
    expect(migration).toContain(
      "create or replace function private.is_language_text_map(value jsonb)",
    );
    expect(migration).not.toContain("alter table public.reply_templates");
    expect(migration).not.toContain("drop constraint");
  });

  it("re-grants execute, since a CHECK runs as the writing role", () => {
    expect(migration).toContain(
      "revoke all on function private.is_language_text_map(jsonb) from public;",
    );
    expect(migration).toContain(
      "grant execute on function private.is_language_text_map(jsonb)\n  to authenticated, service_role;",
    );
  });

  it("stays immutable with an empty search_path", () => {
    // Функцию зовёт CHECK-констрейнт: изменяемая или зависящая от search_path
    // проверка сделала бы значение таблицы невоспроизводимым.
    expect(migration).toContain("immutable");
    expect(migration).toContain("set search_path = ''");
  });
});
