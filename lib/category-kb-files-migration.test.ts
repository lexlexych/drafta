import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260725120000_category_kb_files_and_debounce_timer.sql",
  ),
  "utf8",
);

describe("category knowledge files and debounce timer migration", () => {
  it("adds a nullable kb selection so «inherit» stays distinct from «none»", () => {
    expect(migration).toContain(
      "alter table public.categories\n  add column kb_file_ids uuid[];",
    );
    // Никакого `not null default '{}'` — NULL несёт собственный смысл.
    expect(migration).not.toContain("add column kb_file_ids uuid[] not null");
    expect(migration).toContain(
      "create or replace function private.validate_category_kb_files(",
    );
    expect(migration).toContain(
      "A category knowledge base file must belong to the current workspace",
    );
  });

  it("keeps the tenant inside the conversation→category reference", () => {
    expect(migration).toContain("add column category_id uuid");
    expect(migration).toContain("foreign key (workspace_id, category_id)");
    expect(migration).toContain(
      "references public.categories (workspace_id, id)",
    );
    expect(migration).toContain("on delete set null");
    expect(migration).toContain("create index conversations_category_idx");
  });

  it("publishes the debounce deadline and the manual-review reason", () => {
    expect(migration).toContain("add column draft_debounce_until timestamptz");
    expect(migration).toContain("add column manual_review_reason text");
  });

  it("re-creates the category CRUD RPCs with the new argument", () => {
    expect(migration).toContain(
      "drop function public.create_category(uuid, text, text, text, uuid[], boolean);",
    );
    expect(migration).toContain(
      "drop function public.update_category(uuid, uuid, text, text, text, uuid[], boolean);",
    );
    expect(migration).toContain(
      "category_kb_file_ids uuid[] default null",
    );
    expect(migration).toContain(
      "grant execute on function public.create_category(uuid, text, text, text, uuid[], boolean, uuid[]) to authenticated, service_role;",
    );
    // Дефолтная категория по-прежнему настраивает только разрешённые поля.
    expect(migration).toContain(
      "set draft_instruction = normalized_instruction,\n        skip_draft = category_skip_draft,\n        kb_file_ids = normalized_kb_file_ids,",
    );
  });

  it("routes the manual-review reason through the single guarded write path", () => {
    expect(migration).toContain(
      "drop function public.finalize_draft_generation(uuid, uuid, text, text, boolean);",
    );
    expect(migration).toContain("review_reason text default null");
    expect(migration).toContain("manual_review_reason = normalized_reason");
    // Инвариант «один ready на диалог» держится тем же локом на conversations.
    expect(migration).toContain("for update");
    expect(migration).toContain(
      "grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text)\n  to service_role;",
    );
  });
});
