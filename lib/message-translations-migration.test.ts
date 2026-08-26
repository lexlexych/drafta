import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а многострочные ожидания ниже написаны через LF.
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260827100000_message_translations.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("message_translations migration contract", () => {
  it("keys the cache by message and target language", () => {
    // Это и есть кэш: смена языка workspace не должна обесценивать уже
    // сделанные переводы, поэтому язык входит в ключ, а не заменяет строку.
    expect(migration).toContain(
      "unique (workspace_id, message_id, target_language)",
    );
  });

  it("references the message the only way messages allow", () => {
    // У `messages` есть unique (workspace_id, conversation_id, id) и нет
    // unique (workspace_id, id) — двухколоночный FK туда невозможен.
    expect(migration).toContain(
      "foreign key (workspace_id, conversation_id, message_id)",
    );
    expect(migration).toContain(
      "references public.messages(workspace_id, conversation_id, id) on delete cascade",
    );
  });

  it("cascades from the workspace, so erasure stays one delete", () => {
    expect(migration).toContain(
      "workspace_id uuid not null references public.workspaces(id) on delete cascade",
    );
  });

  it("checks the shape of a language code without pinning the list", () => {
    // Добавление языка интерфейса не должно требовать миграции — та же логика,
    // что у reply_templates.bodies.
    expect(migration).toContain(
      "target_language text not null\n    check (target_language ~ '^[a-z]{2}(-[a-z]{2})?$')",
    );
    expect(migration).toContain(
      "source_language text\n    check (source_language ~ '^[a-z]{2}(-[a-z]{2})?$')",
    );
  });

  it("lets a workspace member write its own cache under RLS", () => {
    // В отличие от ai_usage пишет не service_role: перевод запускает участник
    // workspace синхронным server action.
    expect(migration).toContain(
      "alter table public.message_translations enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.message_translations from anon;",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.message_translations to authenticated;",
    );
    expect(migration).toContain("create policy message_translations_member_access");
    expect(migration).toContain(
      "using ((select private.is_workspace_member(workspace_id)))",
    );
    expect(migration).toContain(
      "with check ((select private.is_workspace_member(workspace_id)))",
    );
  });

  it("indexes the read path the thread actually uses", () => {
    expect(migration).toContain(
      "on public.message_translations (workspace_id, conversation_id, target_language)",
    );
  });

  it("adds translation to both AI journals", () => {
    // Иначе учёт токенов молча падает в console.error, и стоимость перевода
    // нигде не видна — см. lib/db/ai-usage.ts.
    for (const table of ["ai_usage", "ai_request_log"]) {
      expect(migration).toContain(
        `alter table public.${table} drop constraint ${table}_operation_check;`,
      );
      expect(migration).toContain(
        "check (operation in ('classification', 'draft', 'translation'))",
      );
    }
  });
});
