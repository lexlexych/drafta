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
    "20260828100000_comment_translations.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("comment_translations migration contract", () => {
  it("keys the cache by comment and target language", () => {
    // То же решение, что у сообщений: смена языка workspace не обесценивает
    // уже сделанные переводы, поэтому язык входит в ключ.
    expect(migration).toContain(
      "unique (workspace_id, comment_id, target_language)",
    );
  });

  it("references the comment with a two-column FK, which comments allow", () => {
    // У `comments`, в отличие от `messages`, есть unique (workspace_id, id) —
    // тройной FK как у message_translations здесь не нужен.
    expect(migration).toContain("foreign key (workspace_id, comment_id)");
    expect(migration).toContain(
      "references public.comments(workspace_id, id) on delete cascade",
    );
  });

  it("keeps post_id for the thread-wide lookup, cascading from the post too", () => {
    // Тред читает все свои переводы одним запросом — ради этого пути колонка и
    // существует; FK делает её честной, а не просто денормализацией.
    expect(migration).toContain("foreign key (workspace_id, post_id)");
    expect(migration).toContain(
      "references public.posts(workspace_id, id) on delete cascade",
    );
    expect(migration).toContain(
      "on public.comment_translations (workspace_id, post_id, target_language)",
    );
  });

  it("cascades from the workspace, so erasure stays one delete", () => {
    expect(migration).toContain(
      "workspace_id uuid not null references public.workspaces(id) on delete cascade",
    );
  });

  it("constrains both language codes to the shape the app writes", () => {
    expect(migration).toContain(
      "target_language text not null\n    check (target_language ~ '^[a-z]{2}(-[a-z]{2})?$')",
    );
    expect(migration).toContain(
      "source_language text\n    check (source_language ~ '^[a-z]{2}(-[a-z]{2})?$')",
    );
  });

  it("puts the cache behind RLS, writable by workspace members", () => {
    // Пишет пользовательский клиент, а не service_role: перевод запускает
    // участник workspace синхронным server action.
    expect(migration).toContain(
      "alter table public.comment_translations enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.comment_translations from anon",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.comment_translations to authenticated",
    );
    expect(migration).toContain("create policy comment_translations_member_access");
    expect(migration).toContain(
      "using ((select private.is_workspace_member(workspace_id)))",
    );
    expect(migration).toContain(
      "with check ((select private.is_workspace_member(workspace_id)))",
    );
  });

  it("does not re-touch the AI journals: 'translation' and 'comment' already exist", () => {
    // 20260827100000 расширила словарь операций, а surface допускает 'comment'
    // с 20260726100000 — повторный ALTER здесь только сломал бы накат.
    expect(migration).not.toContain("alter table public.ai_usage");
    expect(migration).not.toContain("alter table public.ai_request_log");
  });
});
