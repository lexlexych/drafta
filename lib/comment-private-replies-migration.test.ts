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
    "20260828120000_comment_private_replies.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("comment_private_replies migration contract", () => {
  it("lets the schema hold Meta's one-reply-per-comment rule", () => {
    // Это главное, ради чего таблица отдельная: два одновременных нажатия не
    // должны превратиться в два сообщения у человека.
    expect(migration).toContain("unique (workspace_id, comment_id)");
  });

  it("cascades from the workspace and from the comment itself", () => {
    expect(migration).toContain(
      "workspace_id uuid not null references public.workspaces(id) on delete cascade",
    );
    expect(migration).toContain("foreign key (workspace_id, comment_id)");
    expect(migration).toContain(
      "references public.comments(workspace_id, id) on delete cascade",
    );
    expect(migration).toContain("foreign key (workspace_id, post_id)");
    expect(migration).toContain(
      "references public.posts(workspace_id, id) on delete cascade",
    );
  });

  it("tracks the send the way every other outgoing row does", () => {
    // pending → sent/failed: строка появляется до похода к провайдеру, потому
    // что отправляет Inngest-функция с ретраями, а не запрос.
    expect(migration).toContain(
      "status text not null default 'pending'\n    check (status in ('pending', 'sent', 'failed'))",
    );
    expect(migration).toContain("external_id text");
  });

  it("refuses a blank message at the schema level", () => {
    expect(migration).toContain(
      "constraint comment_private_replies_text_check\n    check (length(btrim(text)) > 0)",
    );
  });

  it("keeps updated_at honest with the shared trigger", () => {
    expect(migration).toContain(
      "create trigger comment_private_replies_set_updated_at",
    );
    expect(migration).toContain(
      "for each row execute function private.set_updated_at()",
    );
  });

  it("puts the table behind RLS for members and the worker", () => {
    expect(migration).toContain(
      "alter table public.comment_private_replies enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.comment_private_replies from anon",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.comment_private_replies to authenticated",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.comment_private_replies to service_role",
    );
    expect(migration).toContain(
      "create policy comment_private_replies_member_access",
    );
    expect(migration).toContain(
      "using ((select private.is_workspace_member(workspace_id)))",
    );
  });
});
