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
    "20260903100000_conversation_list_entries.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("conversation list entries migration contract", () => {
  it("runs the view with the caller's rights, not the owner's", () => {
    // Без `security_invoker` вью исполнялось бы правами своего владельца и
    // показало бы чужой workspace мимо RLS — правило 3.
    expect(migration).toContain(
      "create view public.conversation_list_entries\nwith (security_invoker = on) as",
    );
  });

  it("keeps only threads that already carry a message", () => {
    expect(migration).toContain(
      "where exists (\n  select 1\n  from public.messages m\n  where m.conversation_id = c.id\n)",
    );
  });

  it("lists the conversation columns explicitly instead of c.*", () => {
    // `*` в определении вью разворачивается один раз при создании: колонка,
    // добавленная в `conversations` позже, молча не появилась бы в списке.
    expect(migration).not.toContain("select c.*");

    for (const column of [
      "c.id",
      "c.workspace_id",
      "c.channel_connection_id",
      "c.contact_id",
      "c.external_id",
      "c.status",
      "c.snoozed_until",
      "c.last_incoming_at",
      "c.unread_count",
      "c.matched_kb_file_ids",
      "c.created_at",
      "c.updated_at",
    ]) {
      expect(migration).toContain(`  ${column}`);
    }
  });

  it("does not drop the empty threads it hides", () => {
    // Диалог остаётся в БД и вернётся в список с первым же сообщением —
    // прячется строка, а не данные.
    expect(migration).not.toMatch(/delete\s+from\s+public\.conversations/i);
  });
});
