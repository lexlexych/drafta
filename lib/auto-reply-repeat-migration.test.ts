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

const migration = readMigration("20260907110000_auto_reply_repeat_scenario.sql");
const original = readMigration("20260907100000_auto_reply.sql");

describe("auto reply repeat-scenario migration contract", () => {
  it("adds the new outcome without losing the old ones", () => {
    // Словарь перечисляется целиком, поэтому потерять значение здесь легко:
    // строки журнала со старым исходом перестали бы вставляться.
    const outcomes = [
      "sent",
      "disabled",
      "no_text",
      "below_threshold",
      "no_template",
      "template_missing",
      "no_template_language",
      "cancelled_by_operator",
      "superseded",
      "failed",
    ];

    for (const outcome of outcomes) {
      expect(original).toContain(`'${outcome}'`);
      expect(migration).toContain(`'${outcome}'`);
    }

    expect(migration).toContain("'repeat_scenario'");
  });

  it("replaces the constraint rather than adding a second one", () => {
    expect(migration).toContain(
      "alter table public.auto_reply_runs drop constraint auto_reply_runs_outcome_check;",
    );
    expect(migration).toContain(
      "alter table public.auto_reply_runs add constraint auto_reply_runs_outcome_check",
    );
  });

  it("keeps the column comment in step with the dictionary", () => {
    // Комментарий колонки — единственное место, где исходы описаны словами;
    // разойдясь со списком, он врёт тому, кто читает журнал.
    expect(migration).toContain(
      "comment on column public.auto_reply_runs.outcome is",
    );
    expect(migration).toContain("repeat_scenario — тот же сценарий");
  });

  it("changes nothing but the dictionary", () => {
    // Правило живёт в пайплайне: данных для него хватает тех, что уже есть.
    // Новых таблиц, колонок и функций миграция не заводит.
    expect(migration).not.toContain("create table");
    expect(migration).not.toContain("add column");
    expect(migration).not.toContain("create function");
  });
});
